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

import { createQueue, type FlushReport, type OfflineQueue, type QueueSummary, type Sender } from './queue'
import { createQueueStore, type KeyValueStore } from './queueStore'
import { createSender, type SenderClient } from './sender'
import {
  TRAINING_TABLES,
  applyQueue,
  emptyTrainingDb,
  parentRefs,
  presetsToSeed,
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
  /** 單一請求的逾時。 */
  fetchTimeoutMs?: number
  /** 一頁拉幾列。PostgREST 預設單次最多 1000，不能超過。 */
  pageSize?: number
  now?: () => number
}

export const BASE_STORAGE_KEY = 'training-base'

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
  const { kv, client, fetchTimeoutMs = 8000, pageSize = 1000 } = deps

  let base: { userId: string; db: TrainingDb } | null = null
  let source: TrainingView['source'] = 'empty'
  let cacheError = false
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

  async function fetchAll(): Promise<TrainingDb> {
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
  const adoptFresh = (userId: string, fresh: TrainingDb): Promise<void> =>
    serial(async () => {
      base = { userId, db: fresh }
      source = 'server'
      await persistBase()
    })

  const rawSender = createSender(client)
  /** 送成功的條目就地併進底，並寫回本機。 */
  const send: Sender = async (entry, signal) => {
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

  const queue = createQueue({ store: createQueueStore(kv), send, now: deps.now })

  async function composeView(userId: string): Promise<TrainingView> {
    const entries = await queue.entries()
    const db = applyQueue(base && base.userId === userId ? base.db : emptyTrainingDb(), entries, userId)
    return { db, source, summary: await queue.summary(userId), cacheError }
  }

  async function write(userId: string, ops: readonly WriteOp[]): Promise<TrainingView> {
    for (const o of ops) {
      await queue.enqueue({
        op: o.op,
        table: o.table,
        rowId: o.rowId,
        userId,
        ...(o.op === 'delete' ? {} : { payload: o.payload, parents: parentRefs(o.table, o.payload ?? {}) }),
        ...(o.ignoreDuplicates ? { ignoreDuplicates: true } : {}),
      })
    }
    return composeView(userId)
  }

  /** 一個動作都沒有就預填。看的是疊上佇列後的畫面：預填排進佇列之後就不會再預填第二次。 */
  async function seedIfEmpty(userId: string): Promise<TrainingView> {
    const view = await composeView(userId)
    const rows = presetsToSeed(userId, view.db.exercises) // 已有動作就是空陣列，write 不排任何東西
    return write(
      userId,
      rows.map((r) => ({
        op: 'insert' as const,
        table: 'exercises' as const,
        rowId: r.id,
        payload: { ...r },
        ignoreDuplicates: true,
      })),
    )
  }

  return {
    queue,

    async load(userId) {
      try {
        await adoptFresh(userId, await fetchAll())
      } catch {
        // 讀不到伺服器：退回本機底；本機也沒有就是 empty
        await readCachedBase(userId)
        if (base && base.userId === userId) source = 'cache'
        else {
          base = null
          source = 'empty'
        }
      }
      return seedIfEmpty(userId)
    },

    async view(userId) {
      await readCachedBase(userId)
      return composeView(userId)
    },

    write,

    async flush(userId) {
      const report = await queue.flush(userId)
      if (report.sent > 0 && !(base && base.userId === userId)) {
        // 底不存在（第一次就離線記錄）：已送出的條目沒地方併，重拉一次；拉不到下次 load 會補
        try {
          await adoptFresh(userId, await fetchAll())
        } catch {
          // 留給下一次 load
        }
      }
      return { report, view: await composeView(userId) }
    },

    async clearAll() {
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
