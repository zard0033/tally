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

/** 伺服器端外鍵的 on delete。決定父列「不會存在了」（離線新增又刪、被拒絕後放棄）時子列怎麼辦：
 *  cascade＝子列跟著消失；setNull＝子列留下、那一欄改成 null；restrict＝子列沒有它就存不了。 */
export type OnParentDelete = 'cascade' | 'restrict' | 'setNull'

/** 指向一列。父列依賴用它描述「這一條要等哪幾列先到」。 */
export interface RowRef {
  readonly table: string
  readonly rowId: string
  /** 子列的哪一欄指向它；setNull 時改的就是這一欄。 */
  readonly column?: string
  /** 沒標明＝cascade（最保守的舊行為：父列不在，子列一起走）。 */
  readonly onDelete?: OnParentDelete
}

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
  /** 外鍵指向的父列（AC 16）。父列這一輪沒送成，這一條就不送——送了只會撞外鍵 409，
   *  被標成 rejected，把「父列還沒到」誤報成「這條被拒絕」。沒有父列（或父列早已在伺服器）就省略。 */
  readonly parents?: readonly RowRef[]
  /** 只對 insert 有意義：該列已存在就不動它（on conflict do nothing），而不是以這一條覆蓋。
   *  給「預填」用——離線時本機快取還是空的就預填，回線後不能蓋掉伺服器上已被使用者改過的同 id 列。 */
  readonly ignoreDuplicates?: true
  readonly userId: string
  readonly createdAt: number
  /** 已開始送出的次數。**送出前**就寫進儲存：送到一半被殺掉，重開後看得出「可能已生效」。 */
  readonly attempts: number
  readonly lastError: string | null
  /** 最後一次失敗的分類；從未失敗、或正在重送時為 null。 */
  readonly failure: FailureKind | null
  /** 曾經有一次嘗試結果曖昧（逾時、連不上、5xx）：請求可能已落地。**黏著的**——之後某次得到
   *  401／4xx 不代表先前那次沒生效，不能因為「最後一次」是明確失敗就當它從沒到過伺服器。 */
  readonly maybeApplied?: true
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
  /** 見 QueueEntry.parents。delete 不需要（刪除靠伺服器端 cascade）。 */
  parents?: readonly RowRef[]
  /** 見 QueueEntry.ignoreDuplicates。只在 insert 時採用。 */
  ignoreDuplicates?: boolean
  userId: string
}

/** 傳送結果。`status` 沿用 postgrest-js 的語意：伺服器回應就是 HTTP 狀態碼，
 *  **0＝請求沒有得到回應**（斷網、DNS、AbortSignal.timeout，見其 PostgrestBuilder 的 catch 分支）。
 *  真正的 adapter 在階段 2 寫，要自己從 `{ error, status }` 組出這個形狀——api.ts 現有的函式
 *  只丟 `new Error(message)`，status 在那裡就掉了，不能拿它們當 sender。 */
export type SendResult = { ok: true } | { ok: false; status: number; message: string }
/** 傳送一條。**契約**（寫 adapter 的人要守，錯了就是丟資料，佇列在這頭看不出來）：
 *  - `ok: true` 必須代表「寫入確實生效」。insert／update 的 2xx 但 0 列受影響（RLS 擋下、列不存在）
 *    要自己檢查筆數並回失敗，否則佇列會把唯一的一份當成功移除。
 *    **delete 例外：0 列＝目標狀態已達成，回 ok**（列本來就不在，或前一個請求已經刪掉了）。
 *    RLS 擋下的 delete 與「列不在」在 PostgREST 看起來一樣、分不出來——接受這個缺口，
 *    否則「離線新增又刪掉」這種最普通的流程會留下永遠卡住的 delete。
 *  - insert 必須是 upsert（以 rowId 為鍵）：回應遺失後重送若撞到 409，該列會被標 rejected 卡住。
 *    **例外**：條目帶 `ignoreDuplicates` 時改成 on conflict do nothing，且「已存在、0 列」算成功。
 *  - update／delete 不要用 `.single()`：0 列會得 406，永遠重試不成功。
 *  - `signal` 在逾時時會被 abort，**必須傳給底層 fetch**（supabase 的 `.abortSignal(signal)`）。
 *    否則逾時只是佇列不再等，請求仍可能稍後落地——佇列對這種「晚到的落地」只能防到一半（見 appendEntry）。
 *  - 要在合理時間內 settle：佇列自己有逾時保險（sendTimeoutMs），但那是兜底，不是契約的替代。 */
export type Sender = (entry: QueueEntry, signal: AbortSignal) => Promise<SendResult>

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

/** 確定「伺服器那邊沒有這一條的效果」：從未送過，或伺服器明確回 401／4xx（都在執行前就擋下）。
 *  **結果曖昧的都不算**：正在送出（failure 為 null）、逾時或連不上（offline）、502／504／5xx（transient）——
 *  請求可能已落地、或仍在路上，晚點才到。送到一半被殺掉的條目重開後也屬於這一類。 */
const neverApplied = (e: QueueEntry): boolean =>
  e.attempts === 0 || (!e.maybeApplied && (e.failure === 'rejected' || e.failure === 'auth'))

/** 父列不在時，這條參照會不會把子列一起帶走。restrict 只在「放棄被拒絕的父列」時算：
 *  子列沒有它存不了；但離線刪除不走這條（動作不提供刪除，restrict 的父列不會被刪）。 */
const follows = (p: RowRef, withRestrict: boolean): boolean => {
  const kind = p.onDelete ?? 'cascade'
  return kind === 'cascade' || (withRestrict && kind === 'restrict')
}

/** 以 root 這一列為根，沿會帶走子列的參照往下找出所有子孫列的 key（含 root 自己）。setNull 不跟——
 *  那種子列留下來，由 detachSetNull 改掉指向。
 *  回傳的是「列」的集合而非條目：子列後來的 update 沒有 parents，只能靠列 key 認出它也屬於這一棵。 */
function orphanRows(entries: readonly QueueEntry[], userId: string, root: string, withRestrict: boolean): Set<string> {
  const keys = new Set([root])
  let grew = true
  while (grew) {
    grew = false
    for (const e of entries) {
      if (e.userId !== userId || keys.has(keyOf(e))) continue
      if (e.parents?.some((p) => keys.has(keyOf(p)) && follows(p, withRestrict))) {
        keys.add(keyOf(e))
        grew = true
      }
    }
  }
  return keys
}

/** 父列不會存在了（gone）：以 setNull 指向它的子列照伺服器的做法改成 null、拿掉這條依賴，
 *  子列本身留下（課表被放棄，用它做的訓練不該跟著消失）。 */
function detachSetNull(entries: readonly QueueEntry[], userId: string, gone: ReadonlySet<string>): QueueEntry[] {
  return entries.map((e) => {
    const cut = e.userId === userId ? (e.parents ?? []).filter((p) => p.onDelete === 'setNull' && gone.has(keyOf(p))) : []
    if (cut.length === 0) return e
    const payload = e.payload ? { ...e.payload } : null
    for (const p of cut) if (payload && p.column && payload[p.column] === p.rowId) payload[p.column] = null
    const parents = (e.parents ?? []).filter((p) => !cut.includes(p))
    const { parents: _dropped, ...rest } = e
    return parents.length > 0 ? { ...rest, payload, parents } : { ...rest, payload }
  })
}

/** 放棄 seq 這一條之後的佇列。放棄的是確定沒生效的 insert 時，這一列不會存在：
 *  cascade／restrict 掛在它底下、同樣沒生效的子孫一併放棄（留著只會撞外鍵、永遠卡成 rejected），
 *  setNull 的子列改指向 null 留下。同一列後面的條目不動：放棄只動被點名的那一條（既有契約）。 */
function withoutDiscarded(snap: QueueSnapshot, target: QueueEntry): QueueSnapshot {
  const next = removeEntry(snap, target.seq)
  if (target.op !== 'insert') return next
  const root = keyOf(target)
  if (!neverApplied(target)) {
    // 可能已落地：子孫不能丟（父列也許真的在伺服器上），但 setNull 的連結照樣解開——父列若其實沒到，
    // 子列會帶著它的 id 永遠撞外鍵；解開最多少一個連結（訓練變成「沒照課表」），不解開會賠上整次訓練
    return { ...next, entries: detachSetNull(next.entries, target.userId, new Set([root])) }
  }
  const doomed = orphanRows(next.entries, target.userId, root, true)
  doomed.delete(root)
  const kept = next.entries.filter((e) => !(e.userId === target.userId && doomed.has(keyOf(e)) && neverApplied(e)))
  return { ...next, entries: detachSetNull(kept, target.userId, new Set([...doomed, root])) }
}

/** 加一條。delete 蓋過同一列、同一帳號「確定沒生效」的較舊條目（AC 14 的 tombstone）：留著只是白送。
 *  **結果曖昧的較舊條目不清，留著依 seq 先重送、delete 排在後面**：清掉它再立刻送 delete，
 *  delete 可能趕在它落地之前，之後列就復活了而佇列是空的——delete 一定保留只保證「之後會送」，
 *  不保證「排在舊請求落地之後」。（舊請求若在重送之後才到，這裡防不到，靠 Sender 的 abort。）
 *  另：這一列在佇列裡最早的條目是 insert（本機自己建的）、而且全部從未送出 → 這一列從沒離開過本機，
 *  伺服器上不可能有它，delete 也不必存在（「離線新增、改了幾次、又刪掉」最後佇列是空的）。
 *  最早的若是 update／delete，代表那一列來自伺服器，delete 要留。
 *  之後才排進來的 insert 是合法的重建，不受影響。 */
export function appendEntry(snap: QueueSnapshot, input: NewEntry, now: number): QueueSnapshot {
  if (input.op !== 'delete' && !input.payload) {
    throw new Error(`${input.op} 需要 payload`)
  }
  const target = keyOf(input)
  const sameRow = (e: QueueEntry): boolean => e.userId === input.userId && keyOf(e) === target
  const purged = input.op === 'delete' ? snap.entries.filter((e) => sameRow(e) && neverApplied(e)) : []
  const kept = snap.entries.filter((e) => !purged.includes(e))
  if (input.op === 'delete') {
    const row = snap.entries.filter(sameRow).sort((a, b) => a.seq - b.seq)
    const neverLeftDevice = row.length > 0 && row[0].op === 'insert' && row.every((e) => e.attempts === 0)
    if (neverLeftDevice) {
      // 這一列從沒到過伺服器，掛在它底下、同樣沒送過的子孫（離線新增的訓練連同動作與組）也只剩白送：
      // 留著，父列不存在，它們每一條都會撞外鍵、永遠卡成 rejected。
      const doomed = orphanRows(kept, input.userId, target, false)
      const rest = kept.filter((e) => !(e.userId === input.userId && doomed.has(keyOf(e)) && neverApplied(e)))
      return { nextSeq: snap.nextSeq + 1, entries: detachSetNull(rest, input.userId, doomed) }
    }
  }
  const entry: QueueEntry = {
    seq: snap.nextSeq,
    op: input.op,
    table: input.table,
    rowId: input.rowId,
    payload: input.op === 'delete' ? null : { ...input.payload },
    // delete 不帶：刪除靠伺服器端 cascade，沒有「等父列」的問題（而且帶了會被自己的父列擋住）
    ...(input.op !== 'delete' && input.parents?.length ? { parents: input.parents.map((p) => ({ ...p })) } : {}),
    ...(input.op === 'insert' && input.ignoreDuplicates ? { ignoreDuplicates: true as const } : {}),
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

/** 載入時依 seq 排好：重放順序只認它，不依賴儲存層回傳的順序。nextSeq 也不盲信——
 *  它若落後於已有的 seq，新條目會撞號，replaceEntry／removeEntry 就會同時動到兩條。 */
const normalize = (snap: QueueSnapshot): QueueSnapshot => {
  const entries = [...snap.entries].sort((a, b) => a.seq - b.seq)
  const maxSeq = entries.reduce((m, e) => Math.max(m, e.seq), 0)
  return { nextSeq: Math.max(snap.nextSeq, maxSeq + 1), entries }
}

/* ═══════════ 帶狀態的佇列 ═══════════ */

export interface OfflineQueue {
  /** 回傳排進去的條目；若這次操作與佇列裡從未送出的條目互相抵銷（離線新增又刪掉）則回 null。 */
  enqueue(input: NewEntry): Promise<QueueEntry | null>
  /** 一次排多條、只寫一次儲存：要嘛全部排進去、要嘛一條都沒有（一個動作＋三組不能只存下一半）。 */
  enqueueMany(inputs: readonly NewEntry[]): Promise<void>
  /** 依 seq 重放屬於 userId 的條目。同時只會有一輪在跑，重複呼叫（前景＋TOKEN_REFRESHED）共用同一輪，
   *  且保證 resolve 時「呼叫當下已在佇列裡的條目」都至少試過一次（併進來的呼叫只會發生在那一輪
   *  最後一次掃描之前；掃描之後的呼叫一律開新的一輪）。
   *  儲存寫入失敗（`QueueStore.save` 丟錯）時整個 reject——呼叫端要自己 catch；條目不會因此遺失，
   *  進度也已逐條落地，下次 flush 從停下的地方接著送。 */
  flush(userId: string): Promise<FlushReport>
  /** 目前佇列內全部條目（含其他帳號的），依 seq 排好。給「把未同步的變更疊在畫面上」用，唯讀。 */
  entries(): Promise<readonly QueueEntry[]>
  summary(userId: string): Promise<QueueSummary>
  /** 放棄一條（例如被 rejected 卡住、使用者決定不要了）。回傳有沒有這一條。
   *  放棄的若是確定沒生效的 insert：cascade／restrict 掛在那一列底下的子孫條目連帶放棄（沒有父列存不了），
   *  setNull 的子列留下、那一欄改成 null。會帶走幾條先用 discardImpact 問。 */
  discard(seq: number): Promise<boolean>
  /** 放棄這一條會連帶清掉幾條（不含它自己）。UI 在「放棄這筆」前據此告知會一起消失多少。 */
  discardImpact(seq: number): Promise<number>
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
  /** 跨分頁的互斥鎖（瀏覽器端接 Web Locks）。同名的 fn 在所有分頁之間一次只跑一個。
   *  不給＝只在這個實例內互斥（測試、或確定只有一個實例的環境）。 */
  crossLock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>
}

const STATE_LOCK = 'tally-queue-state'
const FLUSH_LOCK = 'tally-queue-flush'
const noCrossLock = <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn()

const DEFAULT_SEND_TIMEOUT_MS = 20_000

/** **同一份儲存上有多個實例時一定要給 `crossLock`**。兩個實例各自把整份快照寫回去，後寫的會蓋掉先寫的，
 *  seq 也會撞號。「全程序」不夠：同一個 origin 的多個分頁／視窗共用同一份 IndexedDB，它們是不同程序。
 *  給了 crossLock：每次操作在鎖內重讀儲存再寫，整輪 flush 也持鎖（兩個分頁不會同時送同一條）。
 *  iOS 主畫面 App 只有一個實例；桌機多分頁靠瀏覽器端接的 Web Locks。 */
export function createQueue({
  store,
  send,
  now = Date.now,
  sendTimeoutMs = DEFAULT_SEND_TIMEOUT_MS,
  crossLock,
}: Deps): OfflineQueue {
  let state: QueueSnapshot | null = null
  const lock = crossLock ?? noCrossLock
  // 所有對 state 的讀寫排進同一條鏈。flush 在 await send 期間放開，所以 enqueue 不會被網路卡住。
  // 有跨分頁鎖時，每次進鎖都重讀儲存：別的分頁可能剛寫過，記憶體裡那份已經舊了，拿它整份寫回去會蓋掉對方。
  let chain: Promise<unknown> = Promise.resolve()
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(() =>
      lock(STATE_LOCK, async () => {
        if (crossLock) state = null
        return fn()
      }),
    )
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
    const ctrl = new AbortController()
    const timedOut = new Promise<SendResult>((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort() // 讓底層請求真的中止，晚到的落地才不會發生在我們記下「失敗」之後
        resolve({ ok: false, status: 0, message: '送出逾時' })
      }, sendTimeoutMs)
    })
    try {
      // 逾時當 status 0：attempts 已先落地，語意與「回應遺失」相同——可能已落地，下次重送是冪等的
      const r = await Promise.race([send(entry, ctrl.signal), timedOut])
      if (r.ok) return 'ok'
      return { kind: classifyFailure(r.status), message: r.message }
    } catch (e) {
      // sender 丟例外不是正常路徑（它該回 SendResult），但也不能把條目判死：當暫時失敗留著
      return { kind: 'transient', message: e instanceof Error ? e.message : String(e) }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 整輪持有跨分頁的 flush 鎖：兩個分頁同時送，會各自把對方正在送的條目再送一次，
   *  晚到的舊 insert（upsert）可能蓋掉對方已送出的較新 update。 */
  const runFlush = (slot: Slot): Promise<FlushReport> => lock(FLUSH_LOCK, () => runFlushRound(slot))

  async function runFlushRound(slot: Slot): Promise<FlushReport> {
    const { userId } = slot
    let sent = 0
    let stoppedBy: FlushReport['stoppedBy'] = null
    const tried = new Set<number>() // 這一輪每條最多送一次，迴圈必然收斂
    const blocked = new Set<string>() // 這一輪已失敗的目標：同一列後面的條目不能越過它
    // 這一列可能還不存在（它的 insert 失敗或被擋）：子列要等。與 blocked 分開——父列的 update 失敗時
    // 列是存在的，子列的 insert 照送，不該被一起擋住、卡成看不出原因的「待上傳」。
    const missing = new Set<string>()
    // 物件欄位而非區域變數：在 closure 裡賦值，區域變數會被 TS 的流程分析窄化成 null
    const done: { summary: QueueSummary | null } = { summary: null }

    while (!stoppedBy) {
      const entry = await locked(async () => {
        const snap = await current()
        // entries 已依 seq 排好，父列的條目一定在子列之前被看到並嘗試過。
        let next: QueueEntry | undefined
        for (const e of snap.entries) {
          if (e.userId !== userId || tried.has(e.seq) || blocked.has(keyOf(e))) continue
          // 父列這一輪沒送成：這一條不送，也不標失敗；它自己的那一列一併擋住，
          // 孫列（組）看到的父列（動作）才會是「被擋」，一路傳下去。
          if (e.parents?.some((p) => missing.has(keyOf(p)))) {
            blocked.add(keyOf(e))
            if (e.op === 'insert') missing.add(keyOf(e))
            continue
          }
          next = e
          break
        }
        if (!next) {
          // 掃完了：**在同一個鎖內回呼裡**總結並釋放這一輪。不能把總結留給後面另一個 locked 步驟——
          // 它會排在別人（剛進來的 enqueue）後面，那段空檔裡併進來的 flush 會拿到一輪「已掃完、
          // 不會再看佇列」的結果，剛排進去的條目沒人送。釋放之後的 flush 呼叫一律開新的一輪。
          if (inflight === slot) inflight = null
          done.summary = summarize(snap, userId)
          return null
        }
        tried.add(next.seq)
        // 上一次送到一半被殺掉（attempts>0 而 failure 為 null）：那次可能已落地，先記下來再重送
        const interrupted = next.attempts > 0 && next.failure === null
        const marked: QueueEntry = {
          ...next,
          attempts: next.attempts + 1,
          failure: null,
          ...(next.maybeApplied || interrupted ? { maybeApplied: true as const } : {}),
        }
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
          const ambiguous = outcome.kind === 'offline' || outcome.kind === 'transient'
          await commit(
            replaceEntry(snap, {
              ...entry,
              failure: outcome.kind,
              lastError: outcome.message,
              ...(entry.maybeApplied || ambiguous ? { maybeApplied: true as const } : {}),
            }),
          )
        }
        return true
      })

      if (outcome === 'ok') continue
      if (outcome.kind === 'offline' || outcome.kind === 'auth') stoppedBy = outcome.kind
      // 其餘失敗只擋住「同一列」：同一列後面的條目（例如 insert 失敗後的 update、delete）若越過去，
      // update 會打到不存在的列、delete 之後舊 insert 重送會讓那筆復活（AC 14）。
      // 條目已被清掉就沒有東西在前面了，不擋（否則剛排進來的 delete 會白等一輪）。
      else if (existed) {
        blocked.add(keyOf(entry))
        if (entry.op === 'insert') missing.add(keyOf(entry))
      }
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
        return next.entries.find((e) => e.seq === snap.nextSeq) ?? null
      }),

    enqueueMany: (inputs) =>
      locked(async () => {
        const snap = await current()
        const t = now()
        await commit(inputs.reduce((acc, input) => appendEntry(acc, input, t), snap))
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

    entries: () => locked(async () => (await current()).entries),

    summary: (userId) => locked(async () => summarize(await current(), userId)),

    discard: (seq) =>
      locked(async () => {
        const snap = await current()
        const target = snap.entries.find((e) => e.seq === seq)
        if (!target) return false
        await commit(withoutDiscarded(snap, target))
        return true
      }),

    discardImpact: (seq) =>
      locked(async () => {
        const snap = await current()
        const target = snap.entries.find((e) => e.seq === seq)
        if (!target) return 0
        return snap.entries.length - 1 - withoutDiscarded(snap, target).entries.length
      }),

    clear: () =>
      locked(async () => {
        const snap = await current()
        await commit({ nextSeq: snap.nextSeq, entries: [] })
      }),
  }
}
