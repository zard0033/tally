/* ingest-weight 的安全外殼與驗證：把 iOS 捷徑從 Apple 健康讀到的體重／體脂寫進 `weight` 表。
   存在的理由與 AC 在 spec.md「體重自動同步」節。

   這支函式跟 read-label 的信任模型不同，要先講清楚：read-label 驗的是使用者的 JWT，
   這裡的呼叫者是 iOS 捷徑，**它沒辦法登入**，所以門是一把共用祕密（INGEST_TOKEN）。
   對應的設計是縮小爆炸半徑，不是假裝這把祕密很安全——函式只能寫 `weight` 一張表、
   user_id 寫死成 OWNER_USER_ID（不取自請求）、不回傳任何既有資料、寫入冪等（同日 upsert）。
   token 洩漏的最壞後果＝有人能往 weight 寫假資料，而那可以被 Health 的真值重新覆蓋。

   handler 與 index.ts 分開的理由同 read-label：index.ts 碰 Deno 專屬 API，本機沒有 Deno，
   純邏輯留在這裡才驗得動。**本檔不得出現任何 Deno 專屬 API**；環境變數、今天的日期、
   實際寫庫的動作都由 index.ts 讀好／做好再傳進來（所以時鐘與資料庫在測試裡都是可替換的）。 */

export interface WeightRow {
  user_id: string
  measured_on: string
  weight_kg: number
  body_fat_pct: number | null
}

export interface IngestDeps {
  /** INGEST_TOKEN（祕密）。未設或太短一律 fail closed。 */
  token: string | undefined
  /** OWNER_USER_ID：寫入列的 user_id。單人 app，不從請求取。 */
  ownerId: string | undefined
  /** 台北時區的今天（YYYY-MM-DD）。由呼叫端提供，handler 不碰時鐘。 */
  today: string
  /** 實際寫庫。失敗就 throw，handler 收斂成固定的 502。 */
  upsert: (rows: WeightRow[]) => Promise<void>
}

/* 太短的 token 等於沒有門：設定時打錯或貼了半截，比「沒設」更危險，因為看起來有設。 */
const MIN_TOKEN_LEN = 32
const MAX_READINGS = 60
const MAX_BODY_CHARS = 20_000
const WEIGHT_MIN = 30
const WEIGHT_MAX = 250
const BF_MIN = 2
const BF_MAX = 70
/* Health 最早的體重紀錄是 2017。下界只是擋「年份打錯」，不是業務規則。 */
const EARLIEST_DAY = '2015-01-01'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/* 日期只認 YYYY-MM-DD 開頭，後面可以接時間（捷徑「格式化日期」沒關掉時間時會帶）。
   **只取前十碼當日期、不做時區換算**：捷徑給的是手機本地時間，換算只會把半夜量的搬到隔天。 */
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].{0,30})?$/

const UNAUTHORIZED = '未授權'
const MISCONFIGURED = '服務設定不完整'
const METHOD_NOT_ALLOWED = '只接受 POST'
const BAD_REQUEST = '請求格式不正確'
const WRITE_FAILED = '寫入失敗'

/** 診斷 log：只進函式 log、不進回應；**一般路徑只記原因代碼與筆數，不記讀數與 token**。
 *  **例外：502（寫入失敗）會記上游錯誤文字的前 200 字**——PostgREST 的約束錯誤 details 可能夾帶
 *  失敗那一列（user_id 與體重）。log 只有專案擁有者在 Supabase 後台看得到、不進回應；要收緊就改
 *  index.ts 只丟狀態碼，那要重新部署函式（2026-10-12 review 提出，未動）。 */
function diag(tag: string, extra?: Record<string, unknown>): void {
  console.error(`[ingest-weight] ${tag}`, extra ? JSON.stringify(extra) : '')
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  })
}

/**
 * 常數時間比對。長度不同也走完整個迴圈，比較的工作量不隨內容變動
 * （長度本身不是祕密，這裡只是不讓「第幾個字元錯了」從耗時洩漏）。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  const len = Math.max(x.length, y.length)
  let diff = x.length ^ y.length
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/** 取出真實存在的日曆日（2026-02-30 這類回 null）。 */
function parseDay(raw: string): string | null {
  const m = DAY_RE.exec(raw)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

function dayAfter(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + 86_400_000).toISOString().slice(0, 10)
}

/**
 * number 或帶單位的字串（`"24.6%"`、`"77.35 kg"`）。捷徑把 Health 的值塞進 JSON 欄位時，
 * 依欄位型別可能序列化成文字；不接受負號與科學記號——那種輸入只可能是壞資料。
 */
function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:%|kg)?\s*$/i.exec(v)
  return m ? Number(m[1]) : null
}

const round2 = (n: number): number => Math.round(n * 100) / 100

interface Parsed {
  day: string
  /** 原始日期字串，用來在同一天多筆時比先後。 */
  stamp: string
  weight: number
  bodyFat: number | null
}

type ParseResult = { ok: true; value: Parsed } | { ok: false; reason: string }

function parseReading(raw: unknown, maxDay: string): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'not-object' }
  const r = raw as Record<string, unknown>

  const stamp = typeof r.date === 'string' ? r.date.trim() : ''
  const day = parseDay(stamp)
  if (!day) return { ok: false, reason: 'bad-date' }
  if (day < EARLIEST_DAY || day > maxDay) return { ok: false, reason: 'date-out-of-range' }

  const weight = toNum(r.weight_kg)
  if (weight === null || weight < WEIGHT_MIN || weight > WEIGHT_MAX) return { ok: false, reason: 'weight-out-of-range' }

  let bodyFat: number | null = null
  const rawBf = r.body_fat_pct
  if (rawBf !== undefined && rawBf !== null && rawBf !== '') {
    const n = toNum(rawBf)
    if (n === null) return { ok: false, reason: 'bad-bodyfat' }
    /* ≤ 1 當小數換算（HealthKit 的 BodyFatPercentage 內部是 0–1 的比例）。
       1% 以下的體脂本來就不可能，所以這條界線不會誤傷真實的百分比。 */
    const pct = n <= 1 ? n * 100 : n
    if (pct < BF_MIN || pct > BF_MAX) return { ok: false, reason: 'bodyfat-out-of-range' }
    bodyFat = round2(pct)
  }
  return { ok: true, value: { day, stamp, weight: round2(weight), bodyFat } }
}

/**
 * 驗呼叫者（共用祕密）→ 驗整批 payload → 寫庫。
 *
 * 順序刻意如此：method → 設定完整性 → token → body。設定不全回 500 而不是 401，
 * 讓 401 只有「驗證失敗」一個成因（否則缺環境變數碰巧回 401 會讓測試變假綠）。
 */
export async function handleRequest(req: Request, deps: IngestDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: METHOD_NOT_ALLOWED }, 405, { Allow: 'POST' })

  const todayDay = parseDay(deps.today)
  const configured =
    typeof deps.token === 'string' && deps.token.length >= MIN_TOKEN_LEN &&
    typeof deps.ownerId === 'string' && UUID_RE.test(deps.ownerId) &&
    todayDay !== null
  if (!configured) {
    diag('500 misconfigured')
    return json({ error: MISCONFIGURED }, 500)
  }

  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')
  if (!bearer || !timingSafeEqual(bearer[1], deps.token as string)) {
    diag('401', { hasAuthHeader: req.headers.has('Authorization') })
    return json({ error: UNAUTHORIZED }, 401)
  }

  // 通過驗證後才讀 body。整批先驗完，任何一筆不合法就整批不寫（AC4）。
  const declared = Number(req.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_CHARS * 4) {
    diag('400 body-too-large', { declared })
    return json({ error: BAD_REQUEST }, 400)
  }
  let body: unknown
  try {
    const text = await req.text()
    if (text.length > MAX_BODY_CHARS) {
      diag('400 body-too-large', { len: text.length })
      return json({ error: BAD_REQUEST }, 400)
    }
    body = JSON.parse(text)
  } catch {
    diag('400 body-not-json')
    return json({ error: BAD_REQUEST }, 400)
  }

  /* 兩種形狀：`{readings: [...]}`（批次，回填或補送）與單筆物件（捷徑最好建構的形狀——
     三個欄位就是一個 JSON body，不必在捷徑裡拼陣列）。 */
  const wrapped = typeof body === 'object' && body !== null && !Array.isArray(body) &&
    Array.isArray((body as { readings?: unknown }).readings)
  const items: unknown[] = wrapped ? (body as { readings: unknown[] }).readings : [body]
  if (items.length === 0 || items.length > MAX_READINGS) {
    diag('400 bad-count', { count: items.length })
    return json({ error: BAD_REQUEST }, 400)
  }

  const maxDay = dayAfter(todayDay as string)
  const byDay = new Map<string, Parsed>()
  for (let i = 0; i < items.length; i++) {
    const res = parseReading(items[i], maxDay)
    if (!res.ok) {
      diag('400 invalid-reading', { index: i, reason: res.reason })
      return json({ error: BAD_REQUEST }, 400)
    }
    const prev = byDay.get(res.value.day)
    // 同一天多筆：時間字串較大者勝；相同則後面那筆勝（AC8）。
    if (!prev || res.value.stamp >= prev.stamp) byDay.set(res.value.day, res.value)
  }

  const rows: WeightRow[] = [...byDay.values()]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((p) => ({
      user_id: deps.ownerId as string,
      measured_on: p.day,
      weight_kg: p.weight,
      body_fat_pct: p.bodyFat,
    }))

  try {
    await deps.upsert(rows)
  } catch (e) {
    // 錯誤文字可能夾帶 PostgREST 的細節，只進 log、不進回應。
    diag('502 upsert-failed', { reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
    return json({ error: WRITE_FAILED }, 502)
  }
  diag('200 ok', { written: rows.length })
  return json({ written: rows.length }, 200)
}
