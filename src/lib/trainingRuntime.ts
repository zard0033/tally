/* 訓練記錄的執行期：把佇列、sender、本機儲存與「伺服器資料的本機底」組在一起（階段 2 AC 9、15、16、18、19）。
 *
 * 禁沾 DOM／supabase：client 與 key-value 儲存都由呼叫端注入（真正的實作是 supabase-js 與 IndexedDB，
 * 在瀏覽器入口接線），所以這裡能用假的後端完整測試。
 *
 * 為什麼要有「本機底」：佇列只存**尚未同步的變更**。離線時要看到動作庫、要點、上次的值，
 * 以及重開 App 後進行中的訓練，`applyQueue` 需要一份離線也在的底。一個人、量很小，所以每次載入
 * 整包拉回 7 張表、存進本機，離線時以它為底疊上佇列——不做按日期的分段查詢。
 * 成長成本：workout_sets 約每年數千列，分頁拉取（pageSize）；真的慢了再改成只拉近期＋按需補歷史。
 *
 * 底的新鮮度：送成功的條目會就地併進底（不必重拉），所以 flush 之後離線也不會看到剛送出的列消失。 */

import {
  createQueue,
  type FlushReport,
  type OfflineQueue,
  type QueueEntry,
  type QueueSummary,
  type Sender,
} from './queue'
import { createQueueStore, type KeyValueStore } from './queueStore'
import { createSender, type SenderClient } from './sender'
import { autoSeedOps } from './exerciseCatalog'
import {
  TRAINING_TABLES,
  applyQueue,
  emptyTrainingDb,
  parentRefs,
  type Row,
  type TrainingDb,
  type TrainingTable,
} from './training'

/* ═══════════ 注入的 client 形狀 ═══════════ */

export interface ReaderBuilder extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  order(column: string): ReaderBuilder
  range(from: number, to: number): ReaderBuilder
  abortSignal(signal: AbortSignal): ReaderBuilder
}

export interface ReaderClient {
  from(table: string): { select(columns: string): ReaderBuilder }
}

/** 真正的 supabase client 在接線處轉型成這個形狀。 */
export type TrainingClient = ReaderClient & SenderClient

/* ═══════════ 對外介面 ═══════════ */

export interface WriteOp {
  op: 'insert' | 'update' | 'delete'
  table: TrainingTable
  rowId: string
  /** insert／update 必填。 */
  payload?: Record<string, unknown>
  /** 只對 insert 有意義，見 queue.ts。 */
  ignoreDuplicates?: boolean
}

export interface TrainingView {
  /** 伺服器資料（或本機底）疊上未同步變更後的樣子，畫面一律讀這份。 */
  readonly db: TrainingDb
  /** server＝這次剛從伺服器讀到；cache＝讀不到伺服器、用本機底；empty＝連底都沒有。 */
  readonly source: 'server' | 'cache' | 'empty'
  readonly summary: QueueSummary
  /** 目前帳號的未同步條目（依 seq 排好），未同步清單逐條列用。別的帳號的只在 summary.foreign 算數。 */
  readonly entries: readonly QueueEntry[]
  /** 本機底寫不進去（容量、隱私模式）。資料仍在記憶體，但離線重開會讀不到。 */
  readonly cacheError: boolean
}

export interface TrainingRuntime {
  /** 重新讀伺服器；讀不到就退回本機底。一個動作都沒有時（伺服器、本機底都算）預填 16 個。 */
  load(userId: string): Promise<TrainingView>
  /** 不碰網路：記憶體或本機底，疊上佇列。 */
  view(userId: string): Promise<TrainingView>
  /** 排進佇列（父列依賴自動補齊）並回傳新畫面。本機寫入失敗會丟 QueueStorageError。 */
  write(userId: string, ops: readonly WriteOp[]): Promise<TrainingView>
  flush(userId: string): Promise<{ report: FlushReport; view: TrainingView }>
  /** 主動登出：清佇列與本機底。呼叫前由 UI 依 signOutPlan 確認。被動掉線不要呼叫。 */
  clearAll(): Promise<void>
  readonly queue: OfflineQueue
}

export interface TrainingRuntimeDeps {
  kv: KeyValueStore
  client: TrainingClient
  /** 目前 session 的使用者；沒有有效 session 回 null。**送出與讀取前都要對**：supabase-js 在沒有 session 時
   *  （token 過期且 refresh 失敗、登出途中）會改用 anon key 送出——RLS 下 delete 0 列被當成功、讀取回空表，
   *  佇列的刪除就這樣丟了、本機底被空表蓋掉。對不上一律當登入失效，條目留在佇列。 */
  sessionUserId: () => Promise<string | null>
  /** 跨分頁互斥（見 queue.ts 的 crossLock）。瀏覽器接 Web Locks；不給＝只有這一個實例。 */
  crossLock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  /** 單一請求的逾時。 */
  fetchTimeoutMs?: number
  /** 一頁拉幾列。PostgREST 預設單次最多 1000，不能超過。 */
  pageSize?: number
  now?: () => number
}

export const BASE_STORAGE_KEY = 'training-base'

/** 目前的 session 不是這個帳號（或沒有 session）。與「連不上」分開：前者不該預填。 */
class SessionMismatch extends Error {
  constructor() {
    super('登入已失效（沒有這個帳號的有效 session）')
  }
}

/* ═══════════ 本機底的序列化 ═══════════ */

interface StoredBase {
  readonly userId: string
  readonly tables: TrainingDb
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 底只是快取、可以重建，所以認不得就當沒有（不像佇列，那是唯一的一份）。 */
function parseBase(raw: unknown): StoredBase | null {
  if (!isRecord(raw) || typeof raw.userId !== 'string' || !isRecord(raw.tables)) return null
  const tables = {} as Record<TrainingTable, readonly Row[]>
  for (const t of TRAINING_TABLES) {
    const rows = raw.tables[t]
    if (!Array.isArray(rows) || !rows.every((r) => isRecord(r) && typeof r.id === 'string')) return null
    tables[t] = rows as Row[]
  }
  return { userId: raw.userId, tables }
}

/* ═══════════ 實作 ═══════════ */

export function createTrainingRuntime(deps: TrainingRuntimeDeps): TrainingRuntime {
  const { kv, client, sessionUserId, fetchTimeoutMs = 8000, pageSize = 1000 } = deps

  let base: { userId: string; db: TrainingDb } | null = null
  let source: TrainingView['source'] = 'empty'
  let cacheError = false
  /** 主動登出（clearAll）就加一。進行中的 load 讀回來時世代變了＝那是登出前的帳號，不採用、不預填——
   *  否則登出後還在路上的讀取會把底與 16 筆預填寫回裝置。 */
  let generation = 0
  // 對本機底的讀改寫排成一條鏈：flush 途中每送成功一條就會併一次，不能彼此交錯
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn)
    chain = p.catch(() => undefined)
    return p
  }

  async function persistBase(): Promise<void> {
    if (!base) return
    try {
      await kv.set(BASE_STORAGE_KEY, { userId: base.userId, tables: base.db })
      cacheError = false
    } catch {
      cacheError = true // 不丟錯：伺服器才是真相，這份只影響離線重開；旗標交給 UI 決定怎麼講
    }
  }

  /** 記憶體裡沒有這個帳號的底時，從本機儲存讀；讀到才算 cache。 */
  async function readCachedBase(userId: string): Promise<void> {
    if (base && base.userId === userId) return
    try {
      const stored = parseBase(await kv.get(BASE_STORAGE_KEY))
      if (stored && stored.userId === userId) {
        base = { userId, db: stored.tables }
        source = 'cache'
      }
    } catch {
      // 讀不到本機底就當沒有：之後走伺服器；這是快取，不是唯一的一份
    }
  }

  /** session 不是這個帳號就丟錯：呼叫端（load）會退回本機底，不會拿 anon 讀到的空表當真相。 */
  async function assertSession(userId: string): Promise<void> {
    if ((await sessionUserId()) !== userId) throw new SessionMismatch()
  }

  /** 讀之前、讀完都對一次 session：讀取途中被登出，最後幾頁可能已經是 anon 讀的。 */
  async function fetchAll(userId: string): Promise<TrainingDb> {
    await assertSession(userId)
    const db = await fetchTables()
    await assertSession(userId)
    return db
  }

  async function fetchTables(): Promise<TrainingDb> {
    const entries = await Promise.all(
      TRAINING_TABLES.map(async (table) => {
        const rows: Row[] = []
        for (let from = 0; ; from += pageSize) {
          const r = await client
            .from(table)
            .select('*')
            .order('id')
            .range(from, from + pageSize - 1)
            .abortSignal(AbortSignal.timeout(fetchTimeoutMs))
          if (r.error) throw new Error(`${table}：${r.error.message}`)
          const page = Array.isArray(r.data) ? (r.data as Row[]) : []
          rows.push(...page)
          if (page.length < pageSize) break
        }
        return [table, rows] as const
      }),
    )
    return Object.fromEntries(entries) as unknown as TrainingDb
  }

  /** 用剛從伺服器讀到的整包取代底，並寫回本機。 */
  const adoptFresh = (userId: string, fresh: TrainingDb, gen: number): Promise<void> =>
    serial(async () => {
      if (gen !== generation) return
      base = { userId, db: fresh }
      source = 'server'
      await persistBase()
    })

  const rawSender = createSender(client)
  /** 送成功的條目就地併進底，並寫回本機。 */
  const send: Sender = async (entry, signal) => {
    let who: string | null
    try {
      who = await sessionUserId()
    } catch (e) {
      return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) }
    }
    // 沒有 session 或換了人：不送（見 sessionUserId 的說明），401＝這一輪停下、條目原樣保留
    if (who !== entry.userId) return { ok: false, status: 401, message: '登入已失效（沒有這個帳號的有效 session）' }
    const result = await rawSender(entry, signal)
    if (result.ok) {
      await serial(async () => {
        if (base && base.userId === entry.userId) {
          base = { userId: base.userId, db: applyQueue(base.db, [entry], entry.userId) }
          await persistBase()
        }
      })
    }
    return result
  }

  const queue = createQueue({ store: createQueueStore(kv), send, now: deps.now, crossLock: deps.crossLock })

  async function composeView(userId: string): Promise<TrainingView> {
    const { entries, summary } = await queue.read(userId)
    const db = applyQueue(base && base.userId === userId ? base.db : emptyTrainingDb(), entries, userId)
    const mine = entries.filter((e) => e.userId === userId).sort((a, b) => a.seq - b.seq)
    return { db, source, summary, entries: mine, cacheError }
  }

  async function write(userId: string, ops: readonly WriteOp[]): Promise<TrainingView> {
    // 一次寫進去：一個動作＋三組要嘛全存、要嘛都沒存——只存下一半，UI 說「沒有存下來」卻有半份會上傳
    await queue.enqueueMany(
      ops.map((o) => ({
        op: o.op,
        table: o.table,
        rowId: o.rowId,
        userId,
        ...(o.op === 'delete' ? {} : { payload: o.payload, parents: parentRefs(o.table, o.payload ?? {}) }),
        ...(o.ignoreDuplicates ? { ignoreDuplicates: true } : {}),
      })),
    )
    return composeView(userId)
  }

  /** 載入完自動補預設動作（規則見 `autoSeedOps`）。看的是疊上佇列後的畫面：補進佇列之後就不會再補第二次。 */
  async function seedCatalog(userId: string, gen: number): Promise<TrainingView> {
    const view = await composeView(userId)
    const ops = autoSeedOps(userId, view.db.exercises, view.source === 'server') // 不需要補就是空陣列，write 不排任何東西
    // 這個檢查與下面 write 呼叫 enqueueMany 之間不能有 await：中間若插進 clearAll，預填會排在 clear 之後落地
    if (gen !== generation) return view
    return write(
      userId,
      ops.map((o) => ({
        op: 'insert' as const,
        table: 'exercises' as const,
        rowId: o.rowId,
        payload: { ...o.payload },
        ignoreDuplicates: true,
      })),
    )
  }

  return {
    queue,

    async load(userId) {
      const gen = generation
      try {
        await adoptFresh(userId, await fetchAll(userId), gen)
      } catch (e) {
        if (gen !== generation) return composeView(userId)
        // 沒有這個帳號的 session（登出途中、換了人）：連本機底都不該拿來預填——那是在替一個已經離開的帳號排條目
        if (e instanceof SessionMismatch) {
          await readCachedBase(userId)
          if (base && base.userId === userId) source = 'cache'
          return composeView(userId)
        }
        // 讀不到伺服器：退回本機底；本機也沒有就是 empty
        await readCachedBase(userId)
        if (base && base.userId === userId) source = 'cache'
        else {
          base = null
          source = 'empty'
        }
      }
      // 讀取途中被主動登出：不預填（預填會在已清空的裝置上排上百筆屬於舊帳號的條目）
      return seedCatalog(userId, gen)
    },

    async view(userId) {
      await readCachedBase(userId)
      return composeView(userId)
    },

    write,

    async flush(userId) {
      const gen = generation
      const report = await queue.flush(userId)
      if (report.sent > 0 && !(base && base.userId === userId)) {
        // 底不存在（第一次就離線記錄）：已送出的條目沒地方併，重拉一次；拉不到下次 load 會補
        try {
          await adoptFresh(userId, await fetchAll(userId), gen)
        } catch {
          // 留給下一次 load
        }
      }
      return { report, view: await composeView(userId) }
    },

    async clearAll() {
      generation++
      await queue.clear()
      await serial(async () => {
        base = null
        source = 'empty'
        try {
          await kv.set(BASE_STORAGE_KEY, null)
        } catch {
          cacheError = true
        }
      })
    },
  }
}
