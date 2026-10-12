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

/** 最新窗口不夠用時，最多往回找幾天（窗尾往回滑動的天數）。spec AC 11。 */
export const LOOKBACK_DAYS = 90

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

/**
 * 回溯時要抓多少資料：最新窗口再往前加 LOOKBACK_DAYS。
 * 抓資料的範圍與過濾共用同一份窗口定義，不各自推算。
 */
export function baselineFetchRange(today: string): { from: string; end: string } {
  const { from, end } = baselineWindow(today)
  return { from: shiftDate(from, -LOOKBACK_DAYS), end }
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
  return estimateOnSpan(dailyKcal, weights, windowStart(endDate), endDate)
}

/**
 * 任意一段 [startDate, endDate]（含）的估計。最新窗口是固定 28 天；回溯時用的是「一連串記錄」
 * 的整段，長度不一——所以把算法與窗口長度拆開。範圍外的攝取與體重完全不參與。
 */
function estimateOnSpan(
  dailyKcal: readonly DailyKcal[],
  weights: readonly WeightPoint[],
  startDate: string,
  endDate: string,
): BaselineResult {
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

/** 畫面真正要顯示的那一段：可能是最新窗口，也可能是回溯找到的一連串記錄。 */
export interface ShownBaseline {
  result: Extract<BaselineResult, { status: 'ok' }>
  /** 這一段的第一天／最後一天（含） */
  from: string
  end: string
  /** true＝不是最新窗口，是回溯找到的——畫面必須明寫起訖日期，不能讓人當成近 28 天 */
  stale: boolean
}

/** 「同一連串記錄」允許中間漏記幾天：連續記了三週、中間忘了一兩天，不該被切成兩段。 */
const MAX_RUN_GAP_DAYS = 2

interface LoggedRun {
  from: string
  end: string
  loggedDays: number
}

/** 把有記的日子（單日合計 ≥ MIN_DAY_KCAL）串成「連串記錄」，漏記不超過 MAX_RUN_GAP_DAYS 天視為同一串。 */
function loggedRuns(dailyKcal: readonly DailyKcal[], from: string, end: string): LoggedRun[] {
  const days = [...new Set(dailyKcal.filter((d) => d.date >= from && d.date <= end && d.kcal >= MIN_DAY_KCAL).map((d) => d.date))].sort()
  const runs: LoggedRun[] = []
  let cur: LoggedRun | null = null
  for (const day of days) {
    // daysBetween 連續兩天是 1，所以漏記天數 ＝ daysBetween − 1
    if (cur !== null && daysBetween(cur.end, day) - 1 <= MAX_RUN_GAP_DAYS) {
      cur.end = day
      cur.loggedDays += 1
    } else {
      if (cur !== null) runs.push(cur)
      cur = { from: day, end: day, loggedDays: 1 }
    }
  }
  if (cur !== null) runs.push(cur)
  return runs
}

/**
 * 最新窗口不夠用就往回找（spec AC 11）。
 *
 * - 最新窗口 ok ⇒ 用它。
 * - 最新窗口 implausible ⇒ **不回溯**：資料有誤要讓人看見，不用一段乾淨的舊資料把它蓋過去。
 * - 最新窗口 insufficient ⇒ 在抓回來的範圍（最新窗口往前再 LOOKBACK_DAYS）裡找**記錄最多的一連串**，
 *   用**整段**（第一個有記的日子到最後一個有記的日子）與其中所有體重去估；同分取較近的。
 *
 * **為什麼是「一連串記錄的整段」，不是「滑動 28 天窗口」**（兩次踩到，都是真資料／探針抓到的）：
 * ① 取最近一個合格的 28 天窗口——停記後的前幾天仍 ≥ 21 天有記，但體重已經在漲，把數字往下拉
 *   （最近 28 天直接算出 1412，記錄完整那段是約 1780）。
 * ② 滑動窗口再「同分取區間最窄」——每窗只有 4 筆體重時，估計在 1552–1787 之間亂跳，最窄的那個只是
 *   剛好擬合得緊（贏家詛咒），而它的窄範圍連 ~1780 都沒包到。
 * 整段的好處是兩個洞一起補：窗尾落在最後有記的那天（不含停記後的上升），又用上整段的所有體重
 * （點數多、跨度長，斜率才穩）。
 *
 * `current` 一律回最新窗口的結果，讓卡片在顯示舊的一段時仍能說「近 28 天缺什麼」。
 */
export function baselineWithFallback(
  dailyKcal: readonly DailyKcal[],
  weights: readonly WeightPoint[],
  today: string,
): { current: BaselineResult; shown: ShownBaseline | null } {
  const win = baselineWindow(today)
  const current = estimateMaintenance(dailyKcal, weights, win.end)
  if (current.status === 'ok') return { current, shown: { result: current, ...win, stale: false } }
  if (current.status === 'implausible') return { current, shown: null }

  const { from: horizon } = baselineFetchRange(today)
  const runs = loggedRuns(dailyKcal, horizon, win.end)
  let best: ShownBaseline | null = null
  // 由近到遠走，只在「嚴格更多」時才換，所以同分自然留下較近的
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]
    if (run.loggedDays < BASELINE_NEEDS.loggedDays) continue
    const r = estimateOnSpan(dailyKcal, weights, run.from, run.end)
    if (r.status !== 'ok') continue
    if (best === null || r.loggedDays > best.result.loggedDays) {
      best = { result: r, from: run.from, end: run.end, stale: true }
    }
  }
  return { current, shown: best }
}
