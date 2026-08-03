/* 日期處理：一律用本地時區。toISOString() 是 UTC，台灣早上 8 點前會把「今天」算成前一天。
   localDate／shiftDate 照 legacy/app.js 逐字搬；ageFromYear 是 2026-08-03 重新設計，
   刻意偏離 legacy 的 ageOn（只問出生年，不比對月/日），理由見 ageFromYear 的函式註解。 */

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

/** 出生年在 today 那年的年齡（今年－出生年）。只問年份，不問月日——
 *  換掉 date picker 要滾幾十年份的操作成本，換來的是 ±1 歲的誤差，對 BMR 影響是個位數卡路里等級。 */
export function ageFromYear(birthYear: number, today: Date = new Date()): number {
  return today.getFullYear() - birthYear
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
