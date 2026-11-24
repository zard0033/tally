/* 每日目標改版（spec「每日目標改版：目標體重＋速度滑桿」，樣張 _design-sample/goal-v3.html D2）：
   使用者只決定「目標體重」和「速度」，這裡算「往哪個方向」「幾月到」「到了沒」。純邏輯，不沾 DOM。
   目標熱量本身照舊由 computeTargets 算（讀 goal＋rate_kg_per_week），這裡不重算一份。 */
import { rateMonthlyToWeekly, rateWeeklyToMonthly, type Goal } from './formulas'

/** 目標跟現在差不到這麼多就算維持（假設值：跟體重的日常起伏同一個量級，沒有出處；spec「我定的」）。 */
export const GOAL_BAND_KG = 0.5
/** 目標體重步進一格。 */
export const GOAL_STEP_KG = 0.5
/** 跟 DB check 一致（profile.goal_weight_kg between 30 and 250）。 */
export const GOAL_MIN_KG = 30
export const GOAL_MAX_KG = 250

/** 一個月幾天：跟 formulas 的 kg/月 ↔ kg/週 換算同一個基準（52 週 ÷ 12 個月），不另用 30.44。 */
const DAYS_PER_MONTH = (52 / 12) * 7

/** 到 0.1 kg（體重顯示的精度）：0.1 + 0.2 這類浮點誤差不會讓剛好差 0.5 的落在另一邊。 */
const r1 = (n: number) => Math.round(n * 10) / 10
/** 兩邊先各自捨到 0.1 再相減：畫面寫「現在 76.0 kg」，差距就要用 76.0 算（平均體重 75.95 直接減會卡在 x.x5 的捨入）。 */
const gapOf = (goalKg: number, nowKg: number) => r1(r1(goalKg) - r1(nowKg))

/** 由目標體重推方向：比現在輕 0.5 kg 以上＝減重、重 0.5 kg 以上＝增重，其餘＝維持。 */
export function directionOf(goalKg: number, nowKg: number): Goal {
  const gap = gapOf(goalKg, nowKg)
  if (gap <= -GOAL_BAND_KG) return 'cut'
  if (gap >= GOAL_BAND_KG) return 'bulk'
  return 'maintain'
}

/** 「比現在輕 4.4 kg」「比現在重 1.0 kg」「差不到 0.5 kg」——只講距離，方向字由呼叫端照存下的 goal 接。 */
export function gapText(goalKg: number, nowKg: number): string {
  const gap = gapOf(goalKg, nowKg)
  if (Math.abs(gap) < GOAL_BAND_KG) return `差不到 ${GOAL_BAND_KG} kg`
  return `比現在${gap < 0 ? '輕' : '重'} ${Math.abs(gap).toFixed(1)} kg`
}

/** 到了沒：減重時平均體重 ≤ 目標、增重時 ≥ 目標；維持沒有「到」。 */
export function reached(goal: Goal, goalKg: number, nowKg: number): boolean {
  if (goal === 'cut') return r1(nowKg) <= r1(goalKg)
  if (goal === 'bulk') return r1(nowKg) >= r1(goalKg)
  return false
}

/** 資料庫存 kg/週、numeric(3,2)：先捨入再用，畫面預覽才跟存完重讀一樣（每日目標頁原本的 weeklyRate）。 */
export const weeklyRate = (kgPerMonth: number): number => Math.round(rateMonthlyToWeekly(kgPerMonth) * 100) / 100

/** 幾個月到：還差的公斤數 ÷ 每月速度。±0.5 只用來選方向，方向定了之後最後那 0.5 kg 照樣算日期；
 *  維持、速度不是正數、或已經到了（減重時不再比目標重、增重時不再比目標輕）回 null。 */
export function monthsToGoal(goal: Goal, goalKg: number, nowKg: number, kgPerMonth: number): number | null {
  if (goal === 'maintain' || !(kgPerMonth > 0)) return null
  const left = goal === 'cut' ? -gapOf(goalKg, nowKg) : gapOf(goalKg, nowKg)
  if (left <= 0) return null
  return left / kgPerMonth
}

/** 從 today（yyyy-mm-dd）往後加幾個月，回 yyyy-mm-dd。 */
export function addMonths(today: string, months: number): string {
  const [y, m, d] = today.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + Math.round(months * DAYS_PER_MONTH) * 86400000)
  return t.toISOString().slice(0, 10)
}

/** 日期寫成「X 月初／中／底」：1–10 初、11–20 中、21 以後底（spec「我定的」）。
 *  年份看日期本身：今年的不帶；明年、而且月份比這個月早的（11 月看「2 月初」）也不帶，讀起來不會誤會；
 *  明年同月或更晚的（「11 月底」會被讀成今年這個月）寫「明年」，再之後寫西元年。 */
export function arrivalLabel(today: string, date: string): string {
  const [ty, tm] = today.split('-').map(Number)
  const [y, m, d] = date.split('-').map(Number)
  const part = d <= 10 ? '初' : d <= 20 ? '中' : '底'
  const md = `${m} 月${part}`
  if (y === ty || (y === ty + 1 && m < tm)) return md
  return y === ty + 1 ? `明年 ${md}` : `${y} 年 ${md}`
}

/** 結果卡那一行的日期：「4 月初」。算不出來回 null。 */
export function arrivalText(today: string, goal: Goal, goalKg: number, nowKg: number, kgPerMonth: number): string | null {
  const months = monthsToGoal(goal, goalKg, nowKg, kgPerMonth)
  if (months === null) return null
  return arrivalLabel(today, addMonths(today, months))
}

/** 存下的 kg/週 換回 kg/月（給日期用）；沒有或不是數字回 null。 */
export function monthlyOf(rateKgPerWeek: number | null): number | null {
  return rateKgPerWeek !== null && Number.isFinite(rateKgPerWeek) && rateKgPerWeek > 0 ? rateWeeklyToMonthly(rateKgPerWeek) : null
}

/** 目標體重起始值（DB 還沒設時用現在的平均體重）：對齊到步進格、夾在可設範圍內。 */
export function snapGoal(kg: number): number {
  const s = Math.round(kg / GOAL_STEP_KG) * GOAL_STEP_KG
  return Math.min(GOAL_MAX_KG, Math.max(GOAL_MIN_KG, r1(s)))
}
