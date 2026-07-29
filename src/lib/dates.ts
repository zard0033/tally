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
 * 日期區文字（DESIGN.md v2.0）：「週二 7/28」——星期＋月/日，不帶年份。
 * 純字串解析＋`new Date(y, m-1, d)` 只用來查星期幾，不經過 UTC 轉換，跨時區安全；
 * 不帶年份是刻意的（歷史記帳只往回翻幾天，年份不必露出）。
 */
export function weekdayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const weekday = '日一二三四五六'[new Date(y, m - 1, d).getDay()]
  return `週${weekday} ${m}/${d}`
}
