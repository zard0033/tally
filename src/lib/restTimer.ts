/* 組間休息計時器的純邏輯（spec.md「階段 3 甲：組間休息計時器」）。
 *
 * 存「結束時間點」endAt（毫秒時間戳），不存剩餘秒數、也不每秒遞減：鎖屏或切到背景時網頁的 JS 會被暫停，
 * 遞減會停住；endAt 不會，回到前景時用 `endAt − now` 重算就一定準。所以這裡每個函式都吃 `now` 參數，
 * 不自己讀時鐘；localStorage／sessionStorage 也由呼叫端讀了字串傳進來（比照 session.ts），lib 內禁沾 DOM。 */

/** 可選的休息時長（秒），點倒數條上的時長依序循環。 */
export const REST_PRESETS = [60, 90, 120, 180] as const
export type RestPreset = (typeof REST_PRESETS)[number]
export const DEFAULT_REST_SEC: RestPreset = 90

/** −15／＋15 秒。 */
export const REST_ADJUST_SEC = 15
/** 剩餘時間的上限：＋15 加到超過這個值就夾在這個值。 */
export const REST_MAX_MS = 600_000
/** 歸零後多久內回到前景，還算「準時看到」（播提示音、自動收起）；超過就只顯示已過多久，不補響。 */
export const REST_ON_TIME_MS = 2_000
/** 準時歸零後條停留多久自動收起（從 endAt 起算）。 */
export const REST_AUTO_HIDE_MS = 3_000

/** 開始倒數：結束時間點。 */
export function startRest(now: number, seconds: number): number {
  return now + seconds * 1000
}

/** 剩餘毫秒；歸零後為負（超時了多久）。 */
export function remainingMs(endAt: number, now: number): number {
  return endAt - now
}

/** −15／＋15 秒。以「現在起還剩多久」夾在 0～REST_MAX_MS：加到超過上限就停在上限；減到 0 以下就是結束（剩 0）。
 *  已經超時（剩餘為負）時當成剩 0 再加減（超時後按＋15 是重新倒數 15 秒）。畫面的超時狀態目前沒有 ±15 鈕，
 *  所以這是安全的退路，不是使用者走得到的路徑。 */
export function adjustEnd(endAt: number, deltaSec: number, now: number): number {
  const remaining = Math.max(0, endAt - now) + deltaSec * 1000
  return now + Math.min(REST_MAX_MS, Math.max(0, remaining))
}

/** 倒數中的 `m:ss`。無條件進位：還剩 59.001 秒顯示 1:00，剩 59 秒整才顯示 0:59——
 *  所以條上的 0:00 只會出現在真的歸零那一刻，不會提前一秒。≤0 一律顯示 0:00。 */
export function formatRest(ms: number): string {
  const total = ms > 0 ? Math.ceil(ms / 1000) : 0
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** 歸零後的文字。無條件捨去：超時 23.999 秒是「已過 0:23」；不滿 1 秒只寫「休息結束」。 */
export function overtimeText(ms: number): string {
  const over = Math.floor(-ms / 1000)
  if (over < 1) return '休息結束'
  return `休息結束 · 已過 ${Math.floor(over / 60)}:${String(over % 60).padStart(2, '0')}`
}

/** 歸零那刻使用者在前景看著嗎（播提示音、自動收起的條件）：超時不到 REST_ON_TIME_MS。 */
export function firedOnTime(endAt: number, now: number): boolean {
  return now - endAt < REST_ON_TIME_MS
}

/** 時長循環：60→90→120→180→60；不認得的值（含 undefined 的來源）回預設 90。 */
export function nextPreset(current: number): RestPreset {
  const i = REST_PRESETS.indexOf(current as RestPreset)
  if (i === -1) return DEFAULT_REST_SEC
  return REST_PRESETS[(i + 1) % REST_PRESETS.length]
}

/** 驗證 localStorage 裡的時長字串；沒有、不是數字、不在可選清單都回預設 90。 */
export function parsePreset(raw: string | null): RestPreset {
  if (raw === null) return DEFAULT_REST_SEC
  const n = Number(raw)
  return REST_PRESETS.find((p) => p === n) ?? DEFAULT_REST_SEC
}

/** 驗證 sessionStorage 裡的 endAt 字串：沒有、不是有限數字、已經過期、或比上限還遠（壞資料）都回 null。
 *  重新載入頁面時用，過期的倒數不該復活。 */
export function parseEndAt(raw: string | null, now: number): number | null {
  if (raw === null || raw.trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (n <= now || n - now > REST_MAX_MS) return null
  return n
}
