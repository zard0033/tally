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

/* 生理上不可能的結果不給數字（review M1）：一筆打錯的體重（57.5 打成 75.5 的反向、多打一個 0）
   放在窗口兩端或後段，會讓斜率變成每週好幾公斤，算出「−2160 卡」「5760 卡」這種結果，而卡片是要當
   「上限的尺」的——錯得看起來像權威的數字，比「資料不足」糟。
   **這道守門只抓不可能的，不抓所有打錯的**：離群值放在中間時槓桿小，只會推到「看起來合理但錯」
   的地方，這個方法本身抓不到。界取得寬：每週 1.5 kg 對一個 75 kg 的人已是極端，維持熱量
   800–5000 涵蓋所有真實的人。 */
const MAX_PLAUSIBLE_KG_PER_WEEK = 1.5
const PLAUSIBLE_MAINTENANCE = { min: 800, max: 5000 } as const

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
      /** 算得出來但不可能是真的（見 MAX_PLAUSIBLE_KG_PER_WEEK 那段）——帶著數字是為了讓畫面說得出原因 */
      status: 'implausible'
      maintenance: number
      /** kg/週，可能是 NaN／±Infinity（有非有限的體重時） */
      slopeKgPerWeek: number
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

/**
 * 把 intake 的原始列加總成每日合計。營養值是**單份快照**，要乘 qty（Today.tsx 渲染時也是
 * 這樣算）。數字欄位以字串回來也吃（PostgREST 的 numeric 可能是字串）。
 * 不做窗口過濾——那是 estimateMaintenance 的事，界只在一處。
 */
export function dailyKcalFromRows(
  rows: readonly { eaten_on: string; qty: number | string; kcal: number | string }[],
): DailyKcal[] {
  const byDate = new Map<string, number>()
  for (const r of rows) byDate.set(r.eaten_on, (byDate.get(r.eaten_on) ?? 0) + Number(r.kcal) * Number(r.qty))
  return [...byDate].map(([date, kcal]) => ({ date, kcal }))
}

/** 窗口的第一天（含）：窗尾往前 WINDOW_DAYS−1 天，窗口含窗尾共 WINDOW_DAYS 天。 */
const windowStart = (end: string): string => shiftDate(end, -(WINDOW_DAYS - 1))

/**
 * 呼叫端的窗口：窗尾是**昨天**（今天還沒記完不算），窗首往前 27 天。
 * 抓資料的範圍與 estimateMaintenance 的過濾共用這一處定義，不各自推一份（review L4）。
 */
export function baselineWindow(today: string): { from: string; end: string } {
  const end = shiftDate(today, -1)
  return { from: windowStart(end), end }
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
  const startDate = windowStart(endDate)
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
  const slopeKgPerWeek = slope * 7
  if (
    !Number.isFinite(maintenance) ||
    !Number.isFinite(slopeKgPerWeek) ||
    Math.abs(slopeKgPerWeek) > MAX_PLAUSIBLE_KG_PER_WEEK ||
    maintenance < PLAUSIBLE_MAINTENANCE.min ||
    maintenance > PLAUSIBLE_MAINTENANCE.max
  ) {
    return { status: 'implausible', maintenance, slopeKgPerWeek }
  }

  const half = slopeSe * KCAL_PER_KG
  return {
    status: 'ok',
    maintenance,
    low: maintenance - half,
    high: maintenance + half,
    meanIntake,
    slopeKgPerWeek,
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
