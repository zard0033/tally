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

/**
 * 使用者能檢視／記錄到的**最後一天＝明天**（v2.47）。
 *
 * 這條界原本是「今天」（`goToDate` 的 `iso > localDate()` 與右箭頭的 `disabled={isToday}`），
 * **翻案理由**：那條界擋掉的不是錯誤操作，是整個「先排明天、看會不會超過」的用途——
 * 記帳 app 都只能回顧，這一天的餘裕讓數字出現在**還能改變結果的時候**。
 *
 * **為什麼只開一天而不是任意未來**（使用者裁決）：再遠就變成餐點計畫工具，
 * 那是另一個產品；而且每多開一天，「這筆到底吃了沒」的不確定就多一天。
 * 一天剛好是「今晚決定明天」這個真實的使用時機。
 *
 * **刻意做成函式而不是常數**：`localDate()` 每次呼叫都重算，所以跨午夜之後這條界
 * 自己會跟著移動，不必有人記得去刷新。三個呼叫點（goToDate 的上界、預取的上界、
 * 右箭頭的停用條件）共用這一份定義——**界只有一處，才不會有人只改到其中兩處**。
 */
export function maxPlanDate(today: string = localDate()): string {
  return shiftDate(today, 1)
}

/**
 * 這一天**還能改變結果嗎**——今天與明天為真，過去為假（v2.47，precommit deep review 補）。
 *
 * 存在的理由是它被**兩個畫面**問到：今日頁的主數字（要顯示「還能吃」還是「攝取」）、
 * 記一筆 sheet 的確認列（要顯示「剩 N／(+N)」還是「共 N」）。第一版只改了今日頁，
 * sheet 那份仍自己算 `dayData.date === localDate()`，於是**在明天記一筆時確認列退化成
 * 「共 N」——而「看會不會超過」正是這個功能存在的全部理由**，等於在最該用的畫面上失效。
 *
 * **同一條規則被兩處各維護一份，就是這種漏改的來源**；跟 `maxPlanDate()` 同一個道理：
 * 界只有一處定義，才不會有人只改到其中一處。
 */
export function isPlannable(iso: string, today: string = localDate()): boolean {
  return iso >= today
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
