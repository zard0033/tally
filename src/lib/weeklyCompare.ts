/* 吃、練、體重並排（spec「階段 4 丁」，v2.148）的純運算：把每天的攝取、每次訓練、體重趨勢切成週。
   以週為單位是因為體重約一週量一次、訓練一週一兩次，照天畫只看得到雜訊。不沾 DOM。 */
import type { DailyKcal } from './baseline'
import { dayIndex, shiftDate, weekDates } from './dates'
import { cardioRecorded, type TrainingDb } from './training'

/** 一週記完整不到這麼多天＝「記得不完整」，跟完整的週分開畫；沿用回推「一週完整 <4 天暫停」的門檻。 */
export const WEEK_FULL_DAYS = 4

export interface WeekRow {
  /** 週一（yyyy-mm-dd） */
  monday: string
  /** 週一的日序：圖的資料點用（ChartActiveDay 回報的是日序） */
  t: number
  /** 這週落在範圍內的第一天與最後一天：範圍起點與今天會把頭尾那週切掉一半 */
  from: string
  to: string
  /** 今天在這週裡、還沒過完 */
  current: boolean
  /** 記完整（午、晚餐都有記）的天數 */
  fullDays: number
  /** 記完整那幾天的平均攝取（四捨五入到整數）；一天都沒有是 null */
  avgKcal: number | null
  /** 這週訓練幾次 */
  workouts: number
  /** 這週最後一筆量測時的趨勢體重；這週沒量是 null */
  trend: number | null
  /** 這週的趨勢變化＝這週最後一筆的趨勢 − 這週以前最後一筆的趨勢；這週沒量、或之前從沒量過是 null（不插值） */
  trendDelta: number | null
  /** trendDelta 跨了幾週（兩筆量測相隔天數 ÷ 7，四捨五入、至少 1）：中間幾週沒量時，變化是那幾週累積的，畫面要寫出來，
   *  不能當成這一週的變化。trendDelta 是 null 時也是 null */
  deltaWeeks: number | null
}

/**
 * 算「一次」的訓練，回傳它們的日期（同一天兩次就出現兩次）：有打勾的組，或有記有氧分鐘。
 * 開了訓練卻什麼都沒做的不算。
 */
export function countedWorkoutDates(db: TrainingDb): string[] {
  const doneEntries = new Set(db.workout_sets.filter((s) => s.done === true).map((s) => String(s.workout_exercise_id)))
  const counted = new Set(
    db.workout_exercises.filter((we) => doneEntries.has(we.id) || cardioRecorded(we)).map((we) => String(we.workout_id)),
  )
  return db.workouts.filter((w) => counted.has(w.id) && typeof w.performed_on === 'string').map((w) => w.performed_on as string)
}

/**
 * [from, today] 切成週（週一開始），由舊到新。
 * trend 是**全部歷史**算出的趨勢點（由舊到新），所以範圍第一週也拿得到「這週以前」的趨勢來算變化。
 */
export function weeklyRows(args: {
  from: string
  today: string
  daily: readonly DailyKcal[]
  workoutDates: readonly string[]
  trend: readonly { date: string; trend: number }[]
}): WeekRow[] {
  const { from, today, daily, workoutDates, trend } = args
  if (from > today) return []
  const out: WeekRow[] = []
  for (let monday = weekDates(from)[0]; monday <= today; monday = shiftDate(monday, 7)) {
    const sunday = shiftDate(monday, 6)
    const lo = monday < from ? from : monday
    const hi = sunday > today ? today : sunday
    const inWeek = (d: string) => d >= lo && d <= hi
    const full = daily.filter((d) => d.complete && inWeek(d.date))
    const sum = full.reduce((a, d) => a + d.kcal, 0)
    const here = trend.filter((p) => inWeek(p.date))
    const before = trend.filter((p) => p.date < lo)
    const endPt = here.length > 0 ? here[here.length - 1] : null
    const prevPt = before.length > 0 ? before[before.length - 1] : null
    const end = endPt?.trend ?? null
    const prev = prevPt?.trend ?? null
    out.push({
      monday,
      t: dayIndex(monday),
      from: lo,
      to: hi,
      current: sunday > today,
      fullDays: full.length,
      avgKcal: full.length > 0 ? Math.round(sum / full.length) : null,
      workouts: workoutDates.filter(inWeek).length,
      trend: end,
      trendDelta: end !== null && prev !== null ? end - prev : null,
      deltaWeeks: endPt && prevPt ? Math.max(1, Math.round((dayIndex(endPt.date) - dayIndex(prevPt.date)) / 7)) : null,
    })
  }
  return out
}

/** 讀數預設指的那週：上週（這週還沒過完，平均不穩）；範圍裡只有這一週就指這週。 */
export function defaultWeekIndex(rows: readonly WeekRow[]): number {
  if (rows.length === 0) return -1
  const last = rows.length - 1
  return rows[last].current && last > 0 ? last - 1 : last
}

/** 一欄放得下「沒記」兩個字的最多週數（393 寬下 14 週一欄約 21px，再多就擠到隔壁） */
const GAP_TEXT_MAX_WEEKS = 14

/** 每一列底部要寫的字：連續沒記的一段只有中間那週有字，其餘空字串 */
export function gapTexts(rows: readonly WeekRow[]): string[] {
  const out = rows.map(() => '')
  for (let i = 0; i < rows.length; ) {
    if (rows[i].avgKcal !== null) { i++; continue }
    let j = i
    while (j + 1 < rows.length && rows[j + 1].avgKcal === null) j++
    const run = j - i + 1
    out[Math.floor((i + j) / 2)] = (run * GAP_TEXT_MAX_WEEKS) / rows.length >= 1 ? '沒記' : '–'
    i = j + 1
  }
  return out
}
