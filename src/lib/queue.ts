/* 離線寫入佇列核心（階段 1 甲，spec.md AC 9–15）。
 *
 * 這份佇列是「還沒上傳的那幾筆資料唯一的一份」，所以每個決定都往不丟資料那邊偏：
 * 條目只在伺服器明確回成功後才移除；任何失敗都留著、標記原因；寫入失敗時記憶體狀態不前進。
 *
 * 範圍：只有純邏輯。持久化走 QueueStore 介面、傳送走 Sender 介面，兩者都由邊緣注入——
 * IndexedDB adapter 與真正的 Supabase sender 等階段 2 第一個呼叫者出現時才寫（甲裡沒有呼叫者，
 * 現在寫出來只是一份驗不到的程式碼）。AC 15 的「只在前景送」＝這裡不掛任何 visibilitychange／online
 * 監聽、不用 Background Sync，由 App 在開啟或回到前景時呼叫 flush()。
 *
 * 純函式（append／summarize／…）與帶狀態的 createQueue 分開：前者是 mutation 測試的主戰場。 */

export type QueueOp = 'insert' | 'update' | 'delete'

/** 卡住的原因（AC 11）。offline＝連不上，回線就會好；auth＝登入失效，要重新登入；
 *  rejected＝伺服器明確拒絕（4xx 非 401），多半不會自己好，但每輪仍會重試（可能是伺服器端補了東西）；
 *  transient＝408／429／5xx，下次再試。
 *  **rejected 的標籤不等於「該放棄」**：跨列依賴（先送的 insert 失敗，後面引用它的外鍵 409／23503）
 *  也會落在這裡，下一輪就自己好了。介面文案別叫人據此丟掉那一條。 */
export type FailureKind = 'offline' | 'auth' | 'rejected' | 'transient'

export interface QueueEntry {
  /** 佇列內單調遞增的序號，重放順序以它為準。不用 createdAt 排序：Date.now() 同毫秒會平手、
   *  使用者調時鐘會倒退，而順序錯了會讓舊編輯蓋掉新編輯。 */
  readonly seq: number
  readonly op: QueueOp
  readonly table: string
  /** 客戶端產生的主鍵（UUID）。重送冪等靠它：insert／update 由 sender 以它做 upsert 或 .eq，
   *  delete 以它刪除，同一條送幾次結果都一樣。 */
  readonly rowId: string
  /** insert／update 的欄位；delete 為 null。 */
  readonly payload: Readonly<Record<string, unknown>> | null
  readonly userId: string
  readonly createdAt: number
  /** 已開始送出的次數。**送出前**就寫進儲存：送到一半被殺掉，重開後看得出「可能已生效」。 */
  readonly attempts: number
  readonly lastError: string | null
  /** 最後一次失敗的分類；從未失敗、或正在重送時為 null。 */
  readonly failure: FailureKind | null
}

export interface QueueSnapshot {
  /** 下一個要發的 seq。單獨存、清空佇列也不歸零：送出途中被清掉的條目，遲到的結果才不會
   *  對上新條目的同一個 seq。 */
  readonly nextSeq: number
  readonly entries: readonly QueueEntry[]
}

export interface NewEntry {
  op: QueueOp
  table: string
  rowId: string
  /** insert／update 必填；delete 忽略。 */
  payload?: Readonly<Record<string, unknown>>
  userId: string
}

/** 傳送結果。`status` 沿用 postgrest-js 的語意：伺服器回應就是 HTTP 狀態碼，
 *  **0＝請求沒有得到回應**（斷網、DNS、AbortSignal.timeout，見其 PostgrestBuilder 的 catch 分支）。
 *  真正的 adapter 在階段 2 寫，要自己從 `{ error, status }` 組出這個形狀——api.ts 現有的函式
 *  只丟 `new Error(message)`，status 在那裡就掉了，不能拿它們當 sender。 */
export type SendResult = { ok: true } | { ok: false; status: number; message: string }
/** 傳送一條。**契約**（寫 adapter 的人要守，錯了就是丟資料，佇列在這頭看不出來）：
 *  - `ok: true` 必須代表「寫入確實生效」。update／delete 的 2xx 但 0 列受影響（RLS 擋下、列不存在）
 *    要自己檢查筆數並回失敗，否則佇列會把唯一的一份當成功移除。
 *  - insert 必須是 upsert（以 rowId 為鍵）：回應遺失後重送若撞到 409，該列會被標 rejected 卡住。
 *  - update／delete 不要用 `.single()`：0 列會得 406，永遠重試不成功。
 *  - 要在合理時間內 settle：佇列自己有逾時保險（sendTimeoutMs），但那是兜底，不是契約的替代。 */
export type Sender = (entry: QueueEntry) => Promise<SendResult>

export interface QueueStore {
  /** 沒有存過就回 null。 */
  load(): Promise<QueueSnapshot | null>
  save(snapshot: QueueSnapshot): Promise<void>
}

export interface QueueSummary {
  /** 佇列內全部條數，含其他帳號的。 */
  readonly total: number
  /** 屬於目前登入帳號、會被上傳的條數。 */
  readonly mine: number
  /** 屬於其他 user_id、這次登入下不會上傳也不會被動到的條數（AC 13）。 */
  readonly foreign: number
  /** mine 之中從未失敗的。 */
  readonly pending: number
  /** mine 之中最後一次失敗的分類計數（AC 11：讓人看得出卡在哪一種）。 */
  readonly failed: Readonly<Record<FailureKind, number>>
}

export interface FlushReport {
  readonly sent: number
  /** 整批中止的原因：連不上或登入失效時，後面的條目送了也是一樣的結果，不浪費請求。 */
  readonly stoppedBy: 'offline' | 'auth' | null
  readonly summary: QueueSummary
}

/* ═══════════ 純函式 ═══════════ */

export function emptySnapshot(): QueueSnapshot {
  return { nextSeq: 1, entries: [] }
}

/** status → 分類。非 2xx 才會進來。
 *  401 單獨拿出來：PostgREST 在執行前先驗 JWT，過期／無效一律 401；RLS 擋下是 403（rejected）。
 *  不在清單內的怪碼（1xx／3xx）當 transient——保守的一邊是「留著再試」，不是「判死」。 */
export function classifyFailure(status: number): FailureKind {
  if (status === 0) return 'offline'
  if (status === 401) return 'auth'
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'transient'
  if (status >= 400 && status < 500) return 'rejected'
  return 'transient'
}

const keyOf = (e: { table: string; rowId: string }): string => `${e.table}\u0000${e.rowId}`

/** 正在送出：attempts 已落地、結果還沒回來。送到一半被殺掉的條目重開後也長這樣。 */
const inFlight = (e: QueueEntry): boolean => e.attempts > 0 && e.failure === null

/** 加一條。delete 蓋過同一列、同一帳號的較舊條目（AC 14 的 tombstone）：
 *  它們不管送過沒有、落地沒有，delete 之後都會被它抹掉，留著只是白送。
 *  不用區分「已送出但回應遺失的 insert」——那種列可能已在伺服器上，但 delete 本身一定保留，
 *  之後送出時會把它刪掉（對不存在的列是無害的 no-op），不會留下孤兒。
 *  **例外：正在送出的那一條不清。** 它的結果還沒回來；若回的是曖昧回應（閘道 502／504，上游其實還在處理），
 *  清掉它再立刻送 delete，delete 會趕在它落地之前，之後列就復活了、佇列卻是空的。留著它，同一輪裡
 *  delete 被它擋住，等下一輪重送它（冪等）之後才輪到 delete。
 *  之後才排進來的 insert 是合法的重建，不受影響。 */
export function appendEntry(snap: QueueSnapshot, input: NewEntry, now: number): QueueSnapshot {
  if (input.op !== 'delete' && !input.payload) {
    throw new Error(`${input.op} 需要 payload`)
  }
  const target = keyOf(input)
  const kept =
    input.op === 'delete'
      ? snap.entries.filter((e) => e.userId !== input.userId || keyOf(e) !== target || inFlight(e))
      : snap.entries
  const entry: QueueEntry = {
    seq: snap.nextSeq,
    op: input.op,
    table: input.table,
    rowId: input.rowId,
    payload: input.op === 'delete' ? null : { ...input.payload },
    userId: input.userId,
    createdAt: now,
    attempts: 0,
    lastError: null,
    failure: null,
  }
  return { nextSeq: snap.nextSeq + 1, entries: [...kept, entry] }
}

export function summarize(snap: QueueSnapshot, userId: string): QueueSummary {
  const failed: Record<FailureKind, number> = { offline: 0, auth: 0, rejected: 0, transient: 0 }
  let mine = 0
  let pending = 0
  for (const e of snap.entries) {
    if (e.userId !== userId) continue
    mine++
    if (e.failure) failed[e.failure]++
    else pending++
  }
  return { total: snap.entries.length, mine, foreign: snap.entries.length - mine, pending, failed }
}

/** 主動登出前要不要先確認（Q1）：佇列是那幾筆資料唯一的一份，非空就不能默默清掉。
 *  登出會清掉整個佇列（含其他帳號的殘留，之後沒人能上傳它們），所以數的是 total。 */
export function signOutPlan(summary: QueueSummary): { needsConfirm: boolean; lost: number } {
  return { needsConfirm: summary.total > 0, lost: summary.total }
}

const replaceEntry = (snap: QueueSnapshot, next: QueueEntry): QueueSnapshot => ({
  ...snap,
  entries: snap.entries.map((e) => (e.seq === next.seq ? next : e)),
})

const removeEntry = (snap: QueueSnapshot, seq: number): QueueSnapshot => ({
  ...snap,
  entries: snap.entries.filter((e) => e.seq !== seq),
})

/** 載入時依 seq 排好：重放順序只認它，不依賴儲存層回傳的順序。 */
const normalize = (snap: QueueSnapshot): QueueSnapshot => ({
  ...snap,
  entries: [...snap.entries].sort((a, b) => a.seq - b.seq),
})

/* ═══════════ 帶狀態的佇列 ═══════════ */

export interface OfflineQueue {
  enqueue(input: NewEntry): Promise<QueueEntry>
  /** 依 seq 重放屬於 userId 的條目。同時只會有一輪在跑，重複呼叫（前景＋TOKEN_REFRESHED）共用同一輪，
   *  且保證 resolve 時「呼叫當下已在佇列裡的條目」都至少試過一次（併進來的呼叫只會發生在那一輪
   *  最後一次掃描之前；掃描之後的呼叫一律開新的一輪）。
   *  儲存寫入失敗（`QueueStore.save` 丟錯）時整個 reject——呼叫端要自己 catch；條目不會因此遺失，
   *  進度也已逐條落地，下次 flush 從停下的地方接著送。 */
  flush(userId: string): Promise<FlushReport>
  summary(userId: string): Promise<QueueSummary>
  /** 放棄一條（例如被 rejected 卡住、使用者決定不要了）。回傳有沒有這一條。 */
  discard(seq: number): Promise<boolean>
  /** 清空全部。主動登出才呼叫；被動掉線（SIGNED_OUT 非使用者按的）一律不呼叫（AC 13）。 */
  clear(): Promise<void>
}

interface Deps {
  store: QueueStore
  send: Sender
  now?: () => number
  /** 一條送出超過這麼久沒有結果就當「連不上」。iOS 把 App 凍結時，pending 的 fetch 不一定會 reject，
   *  沒有這個，一條永不結束的 send 會讓之後所有 flush 都卡死到重載頁面。 */
  sendTimeoutMs?: number
}

const DEFAULT_SEND_TIMEOUT_MS = 20_000

/** **同一個 store 全程序只能建一個實例**（模組單例）。兩個實例各自把整份快照寫回去，後寫的會蓋掉先寫的，
 *  seq 也會撞號。這裡不在執行期擋——「重開 App」本來就是在同一份儲存上重建——由持有實例的那一層保證。 */
export function createQueue({
  store,
  send,
  now = Date.now,
  sendTimeoutMs = DEFAULT_SEND_TIMEOUT_MS,
}: Deps): OfflineQueue {
  let state: QueueSnapshot | null = null
  // 所有對 state 的讀寫排進同一條鏈。flush 在 await send 期間放開，所以 enqueue 不會被網路卡住。
  let chain: Promise<unknown> = Promise.resolve()
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn)
    chain = p.catch(() => undefined)
    return p
  }
  const current = async (): Promise<QueueSnapshot> => {
    state ??= normalize((await store.load()) ?? emptySnapshot())
    return state
  }
  // 先寫入再前進記憶體：save 失敗時 state 不變，不會出現「記憶體裡有、磁碟上沒有」的條目。
  const commit = async (next: QueueSnapshot): Promise<void> => {
    await store.save(next)
    state = next
  }

  async function attemptSend(entry: QueueEntry): Promise<'ok' | { kind: FailureKind; message: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<SendResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, status: 0, message: '送出逾時' }), sendTimeoutMs)
    })
    try {
      // 逾時當 status 0：attempts 已先落地，語意與「回應遺失」相同——可能已落地，下次重送是冪等的
      const r = await Promise.race([send(entry), timedOut])
      if (r.ok) return 'ok'
      return { kind: classifyFailure(r.status), message: r.message }
    } catch (e) {
      // sender 丟例外不是正常路徑（它該回 SendResult），但也不能把條目判死：當暫時失敗留著
      return { kind: 'transient', message: e instanceof Error ? e.message : String(e) }
    } finally {
      clearTimeout(timer)
    }
  }

  async function runFlush(slot: Slot): Promise<FlushReport> {
    const { userId } = slot
    let sent = 0
    let stoppedBy: FlushReport['stoppedBy'] = null
    const tried = new Set<number>() // 這一輪每條最多送一次，迴圈必然收斂
    const blocked = new Set<string>() // 這一輪已失敗的目標：同一列後面的條目不能越過它
    // 物件欄位而非區域變數：在 closure 裡賦值，區域變數會被 TS 的流程分析窄化成 null
    const done: { summary: QueueSummary | null } = { summary: null }

    while (!stoppedBy) {
      const entry = await locked(async () => {
        const snap = await current()
        const next = snap.entries.find(
          (e) => e.userId === userId && !tried.has(e.seq) && !blocked.has(keyOf(e)),
        )
        if (!next) {
          // 掃完了：**在同一個鎖內回呼裡**總結並釋放這一輪。不能把總結留給後面另一個 locked 步驟——
          // 它會排在別人（剛進來的 enqueue）後面，那段空檔裡併進來的 flush 會拿到一輪「已掃完、
          // 不會再看佇列」的結果，剛排進去的條目沒人送。釋放之後的 flush 呼叫一律開新的一輪。
          if (inflight === slot) inflight = null
          done.summary = summarize(snap, userId)
          return null
        }
        tried.add(next.seq)
        const marked: QueueEntry = { ...next, attempts: next.attempts + 1, failure: null }
        await commit(replaceEntry(snap, marked)) // 送出前先落地
        return marked
      })
      if (!entry) break

      const outcome = await attemptSend(entry)
      const existed = await locked(async () => {
        const snap = await current()
        // 送出期間被 clear／discard／delete 清掉了：結果作廢，不把它加回去
        if (!snap.entries.some((e) => e.seq === entry.seq)) return false
        if (outcome === 'ok') {
          await commit(removeEntry(snap, entry.seq))
          sent++
        } else {
          await commit(replaceEntry(snap, { ...entry, failure: outcome.kind, lastError: outcome.message }))
        }
        return true
      })

      if (outcome === 'ok') continue
      if (outcome.kind === 'offline' || outcome.kind === 'auth') stoppedBy = outcome.kind
      // 其餘失敗只擋住「同一列」：同一列後面的條目（例如 insert 失敗後的 update、delete）若越過去，
      // update 會打到不存在的列、delete 之後舊 insert 重送會讓那筆復活（AC 14）。
      // 條目已被清掉就沒有東西在前面了，不擋（否則剛排進來的 delete 會白等一輪）。
      else if (existed) blocked.add(keyOf(entry))
    }

    // 中止的輪（離線／登入失效）沒走到上面的收尾，在這裡釋放。
    const summary =
      done.summary ??
      (await locked(async () => {
        if (inflight === slot) inflight = null
        return summarize(await current(), userId)
      }))
    return { sent, stoppedBy, summary }
  }

  /** 一輪 flush。 */
  interface Slot {
    readonly userId: string
    promise: Promise<FlushReport>
  }
  let inflight: Slot | null = null

  return {
    enqueue: (input) =>
      locked(async () => {
        const snap = await current()
        const next = appendEntry(snap, input, now())
        await commit(next)
        return next.entries[next.entries.length - 1]
      }),

    flush(userId) {
      if (inflight?.userId === userId) return inflight.promise
      const previous = inflight?.promise
      const slot = { userId } as Slot // promise 在下一行補上，runFlush 要拿 slot 本身
      slot.promise = (async () => {
        if (previous) await previous.catch(() => undefined) // 換帳號：等上一輪跑完再開新的一輪
        return runFlush(slot)
      })()
      inflight = slot
      // 正常收尾由 runFlush 在同步段落內釋放；這裡只兜底（store 寫入失敗讓整輪 reject 的情形）
      const release = () => {
        if (inflight === slot) inflight = null
      }
      slot.promise.then(release, release)
      return slot.promise
    },

    summary: (userId) => locked(async () => summarize(await current(), userId)),

    discard: (seq) =>
      locked(async () => {
        const snap = await current()
        if (!snap.entries.some((e) => e.seq === seq)) return false
        await commit(removeEntry(snap, seq))
        return true
      }),

    clear: () =>
      locked(async () => {
        const snap = await current()
        await commit({ nextSeq: snap.nextSeq, entries: [] })
      }),
  }
}
