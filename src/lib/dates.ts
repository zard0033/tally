/* 日期處理：一律用本地時區。toISOString() 是 UTC，台灣早上 8 點前會把「今天」算成前一天。
   照 legacy/app.js 的 localDate／shiftDate／ageOn 逐字搬。 */

/** 本地時區的 yyyy-mm-dd。不帶參數＝今天。 */
export function localDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** iso 日期字串加減天數，正確處理跨月／跨年／閏日。 */
export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + days))
}

/** birthDate（yyyy-mm-dd）在 today 那天的年齡；月/日還沒到生日就還沒滿一歲。 */
export function ageOn(birthDate: string, today: Date = new Date()): number {
  const b = new Date(birthDate + 'T00:00:00')
  let age = today.getFullYear() - b.getFullYear()
  const m = today.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--
  return age
}

/**
 * 頂欄標題：今天／昨天／星期幾（日期本身另外顯示，不重複）。
 * 新增於 React 遷移（地基階段），照 legacy/app.js 的 dateTitle 逐字搬，語意不變。
 */
export function dateTitle(iso: string, now: Date = new Date()): string {
  const today = localDate(now)
  if (iso === today) return '今天'
  if (iso === shiftDate(today, -1)) return '昨天'
  const [y, m, d] = iso.split('-').map(Number)
  return '週' + '日一二三四五六'[new Date(y, m - 1, d).getDay()]
}
