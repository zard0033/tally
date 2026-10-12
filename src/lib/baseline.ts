/* 實測維持熱量（spec.md「實測維持熱量」節）：用「近 28 天吃了多少」加上「體重怎麼變」
   反推這個人實際每天燒多少，拿來對帳 computeTargets 的公式上限。純對帳、不改任何目標。

     維持熱量 ＝ 平均攝取 − 體重斜率(kg/天) × 7700

   體重持平 ⇒ 吃多少就燒多少；每週掉 0.3 kg ⇒ 吃的比燒的少 330 卡/天，所以燒的比吃的多 330。
   斜率用窗口內全部體重做線性迴歸，不用首尾兩點——首尾兩點會把單次量測的水分波動
   全部算進去。區間是斜率 ±1 個標準誤差換算過來的，**不是信賴區間的嚴格宣稱**，只是讓
   使用者看到「這個數字大約有多不確定」。

   口徑就是記錄口徑：漏記的油與飲料會讓結果偏低。但上限本來就是套在「記下來的熱量」上，
   只要記錄習慣一致，這把尺就是對的。
   lib 內禁止碰 window／document。 */
import { shiftDate } from './dates'
import { KCAL_PER_KG } from './formulas'

export interface DailyKcal {
  /** yyyy-mm-dd */
  date: string
  /** 當天合計（單份快照 kcal × qty 加總） */
  kcal: number
}

export interface WeightPoint {
  /** yyyy-mm-dd */
  date: string
  kg: number
}

/** 窗口長度。spec 寫死 28 天、不開放調整。 */
export const WINDOW_DAYS = 28

/** 單日合計低於這個數視為「沒記完」：不進平均、不算有記天數。 */
export const MIN_DAY_KCAL = 1000

/** 資料夠不夠的三道門檻，改數字要連 spec.md 一起改。 */
export const BASELINE_NEEDS = { loggedDays: 21, weighIns: 4, weightSpanDays: 14 } as const

export type BaselineResult =
  | {
      status: 'insufficient'
      /** 窗口內「有記」的天數（合計 ≥ MIN_DAY_KCAL） */
      loggedDays: number
      weighIns: number
      /** 窗口內最早與最晚體重相差幾天；不足 2 筆為 0 */
      weightSpanDays: number
    }
  | {
      status: 'ok'
      /** 實測維持熱量（卡/天） */
      maintenance: number
      /** ±1 標準誤差 */
      low: number
      high: number
      meanIntake: number
      /** 體重斜率，kg/週（負＝在掉） */
      slopeKgPerWeek: number
      loggedDays: number
      weighIns: number
    }

/** 兩個 yyyy-mm-dd 相差幾天。用 UTC 解析只為了算整數日差，不經本地時區的夏令時間。 */
function daysBetween(from: string, to: string): number {
  const utc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(to) - utc(from)) / 86_400_000)
}

/**
 * endDate 是窗尾（含）——呼叫端傳「昨天」，今天還沒記完不算。
 * 窗口外的資料（含 endDate 之後）完全不參與。
 */
export function estimateMaintenance(
  dailyKcal: readonly DailyKcal[],
  weights: readonly WeightPoint[],
  endDate: string,
): BaselineResult {
  const startDate = shiftDate(endDate, -(WINDOW_DAYS - 1))
  const inWindow = (date: string) => date >= startDate && date <= endDate

  // 同一天若重複，後者覆蓋前者；呼叫端本來就該給每日合計，這裡不替它加總第二次
  const byDate = new Map<string, number>()
  for (const d of dailyKcal) if (inWindow(d.date)) byDate.set(d.date, d.kcal)
  const logged = [...byDate.values()].filter((k) => k >= MIN_DAY_KCAL)

  const pts = weights
    .filter((w) => inWindow(w.date))
    .map((w) => ({ x: daysBetween(startDate, w.date), y: w.kg }))
  const span = pts.length >= 2 ? Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) : 0

  if (
    logged.length < BASELINE_NEEDS.loggedDays ||
    pts.length < BASELINE_NEEDS.weighIns ||
    span < BASELINE_NEEDS.weightSpanDays
  ) {
    return { status: 'insufficient', loggedDays: logged.length, weighIns: pts.length, weightSpanDays: span }
  }

  const meanIntake = logged.reduce((s, k) => s + k, 0) / logged.length

  const n = pts.length
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx // kg/天
  const intercept = my - slope * mx
  const sse = pts.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0)
  const slopeSe = Math.sqrt(sse / (n - 2) / sxx)

  const maintenance = meanIntake - slope * KCAL_PER_KG
  const half = slopeSe * KCAL_PER_KG
  return {
    status: 'ok',
    maintenance,
    low: maintenance - half,
    high: maintenance + half,
    meanIntake,
    slopeKgPerWeek: slope * 7,
    loggedDays: logged.length,
    weighIns: n,
  }
}

/**
 * 照 targetKcal 吃，預期每週體重變化（kg）：負＝會瘦、正＝會胖。
 * 跟 computeTargets 的 dailyDelta 是同一個換算的反方向。
 */
export function expectedWeeklyChangeKg(maintenance: number, targetKcal: number): number {
  return ((targetKcal - maintenance) * 7) / KCAL_PER_KG
}
