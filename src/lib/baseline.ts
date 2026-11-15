/* 實測維持熱量（spec.md「實測維持熱量」節）：用「近 28 天吃了多少」加上「體重怎麼變」
   反推這個人實際每天燒多少，拿來對帳 computeTargets 的公式上限；v2.143 起每週一次，差得不多就自動往它移一半（maintenanceAdvice）。

     維持熱量 ＝ 平均攝取 − 體重斜率(kg/天) × 7700

   體重持平 ⇒ 吃多少就燒多少；每週掉 0.3 kg ⇒ 吃的比燒的少 330 卡/天，所以燒的比吃的多 330。
   斜率用窗口內全部體重做線性迴歸，不用首尾兩點——首尾兩點會把單次量測的水分波動
   全部算進去。區間是斜率 ±1 個標準誤差換算過來的，**不是信賴區間的嚴格宣稱**，只是讓
   使用者看到「這個數字大約有多不確定」。

   口徑就是記錄口徑：漏記的油與飲料會讓結果偏低。
   **2026-11-14 修四項**（spec.md「減重回饋圈 review」，使用者同日核可）：這個人漏記的正好是外食、聚餐這些吃得多的，
   原本的假設讓結果系統性偏低——
   ① 一天「完整」＝午餐、晚餐都有記（原本是合計 ≥ 1000 卡：只記早午餐也過）；
   ② 最新 28 天也只用其中「完整記錄最多的一連串」，跟回溯段同一套（原本整窗平均，整天沒記的週末不在平均裡、卻照樣推高斜率）；
   ③ 最近 7 天完整不到 4 天就暫停、不出新數字（畫面改顯示回溯到的舊段）；
   ④ 開始訓練後頭 28 天的飲食與體重都不用（那幾週的體重變化多半是水和肝醣，7700 卡／kg 不成立）。
   lib 內禁止碰 window／document。 */
import { dayIndex, shiftDate } from './dates'
import { KCAL_PER_KG } from './formulas'

export interface DailyKcal {
  /** yyyy-mm-dd */
  date: string
  /** 當天合計（單份快照 kcal × qty 加總） */
  kcal: number
  /** 這天記完整了沒：午餐、晚餐都有記。不完整的日子不進平均、不算有記天數。 */
  complete: boolean
}

export interface WeightPoint {
  /** yyyy-mm-dd */
  date: string
  kg: number
  /** 量法斷點（v2.138，spec「⑤ 量法斷點」）：換了秤或電池之後的第一筆。斷點前後各自一段，迴歸共用斜率、各段自己的截距 */
  brk?: boolean
}

/**
 * 共用斜率、每段各自截距的迴歸（v2.138）：每段先減掉自己的平均，再合起來算斜率——換電池讓讀數整段平移時，
 * 平移不會被當成變胖或變瘦。只有一段時就是普通的最小平方法。seg 是段號（由舊到新遞增）。
 * 回 slope（每單位 x）、sxx、sse 與段數 k；sxx 為 0（每段都只有一點）時 slope 是 NaN。
 */
export function segmentedFit(pts: readonly { x: number; y: number; seg: number }[]): { slope: number; sxx: number; sse: number; k: number } {
  const groups = new Map<number, { x: number; y: number }[]>()
  for (const p of pts) groups.set(p.seg, [...(groups.get(p.seg) ?? []), p])
  let sxx = 0
  let sxy = 0
  const means: { mx: number; my: number; g: { x: number; y: number }[] }[] = []
  for (const g of groups.values()) {
    const mx = g.reduce((s, p) => s + p.x, 0) / g.length
    const my = g.reduce((s, p) => s + p.y, 0) / g.length
    for (const p of g) {
      sxx += (p.x - mx) ** 2
      sxy += (p.x - mx) * (p.y - my)
    }
    means.push({ mx, my, g })
  }
  const slope = sxy / sxx
  let sse = 0
  for (const { mx, my, g } of means) for (const p of g) sse += (p.y - (my + slope * (p.x - mx))) ** 2
  return { slope, sxx, sse, k: groups.size }
}

/**
 * 一串體重（任意順序）的可用筆數與跨度（v2.138 review）：每多一段就多一個截距要估，等於用掉一筆；
 * 跨度是**各段自己的跨度加總**——切段之後斜率只靠每段內部的分散，兩小段各量兩三天、中間隔很久，首尾相差照樣過關；
 * 只看最長一段又太嚴（斷點落在 28 天中間時兩段各 13 天，斷點後兩週都算不出來）。
 * 沒有斷點時就是筆數與首尾相差的天數，跟原本一樣。
 */
export function segmentSpread(ws: readonly { date: string; brk?: boolean }[]): { usable: number; span: number } {
  const sorted = [...ws].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const segs = segmentIds(sorted)
  const bySeg = new Map<number, string[]>()
  sorted.forEach((w, i) => bySeg.set(segs[i], [...(bySeg.get(segs[i]) ?? []), w.date]))
  const span = [...bySeg.values()].reduce((s, dates) => s + spanDays(dates), 0)
  return { usable: sorted.length - Math.max(0, bySeg.size - 1), span }
}

/** 由舊到新排好的日期與斷點旗標 → 每一筆的段號。斷點標在第一筆上不算切段（前面沒有東西可比）。 */
export function segmentIds(points: readonly { brk?: boolean }[]): number[] {
  let seg = 0
  return points.map((p, i) => (p.brk && i > 0 ? ++seg : seg))
}

/** 窗口長度。spec 寫死 28 天、不開放調整。 */
export const WINDOW_DAYS = 28

/** 資料夠不夠的門檻，改數字要連 spec.md 一起改。recentDays：最近 RECENT_DAYS 天裡至少幾天完整，不到就暫停（MacroFactor 的做法）。 */
export const BASELINE_NEEDS = { loggedDays: 21, weighIns: 4, weightSpanDays: 14, recentDays: 4 } as const

/** 「最近一週」的長度（含窗尾）。 */
export const RECENT_DAYS = 7

/** 開始訓練後這麼多天（含第一天）的資料不用。Heymsfield 2012：減重頭幾週每 kg 的熱量遠低於 7700；訓練開始時的水分、肝醣同理。 */
export const SETTLE_DAYS = 28

/* 生理上不可能的結果不給數字（review M1）：一筆打錯的體重（57.5 打成 75.5 的反向、多打一個 0）
   放在窗口兩端或後段，會讓斜率變成每週好幾公斤，算出「−2160 卡」「5760 卡」這種結果，而卡片是要當
   「上限的尺」的——錯得看起來像權威的數字，比「資料不足」糟。
   **這道守門只抓不可能的，不抓所有打錯的**：離群值放在中間時槓桿小，只會推到「看起來合理但錯」
   的地方，這個方法本身抓不到。界取得寬：每週 1.5 kg 對一個 75 kg 的人已是極端，維持熱量
   800–5000 涵蓋所有真實的人。 */
const MAX_PLAUSIBLE_KG_PER_WEEK = 1.5

/** 每天體重的隨機波動 σ（kg），算理論標準誤差用。Cheuvront 2004 晨起 0.51±0.20 kg；本 spec 2026-10-12 的 Monte Carlo 用 0.4。
 *  筆數少時殘差估本身不可靠（4 筆時自由度只剩 2，同一段資料隔天就從 ±141 變 ±78），所以取兩者較大。 */
export const WEIGHT_SD_KG = 0.4
const PLAUSIBLE_MAINTENANCE = { min: 800, max: 5000 } as const

export type BaselineResult =
  | {
      status: 'insufficient'
      /** 用的那一連串裡完整的天數（窗口裡沒有任何完整的日子時為 0） */
      loggedDays: number
      weighIns: number
      /** 那一段裡最早與最晚體重相差幾天；不足 2 筆為 0 */
      weightSpanDays: number
      /** 最近 RECENT_DAYS 天裡完整的天數；不到 BASELINE_NEEDS.recentDays 就暫停 */
      recentDays: number
      /** 開始訓練後的排除段還擋著：最快這天之後算得出來（排除段最後一天＋loggedDays 天，之後每天都記完整的話）；否則 null */
      settlingUntil: string | null
    }
  | {
      /** 算得出來但不可能是真的（見 MAX_PLAUSIBLE_KG_PER_WEEK 那段）——帶著數字是為了讓畫面說得出原因 */
      status: 'implausible'
      maintenance: number
      /** kg/週，可能是 NaN／±Infinity（有非有限的體重時） */
      slopeKgPerWeek: number
      /** 為什麼不可能——畫面要叫人去查對的東西：slope＝體重走勢離譜（查體重紀錄）、
       *  range＝維持熱量落在界外而斜率正常（多半是飲食記錄的份量或熱量打錯）、non-finite＝算不出來。 */
      reason: 'slope' | 'range' | 'non-finite'
    }
  | {
      status: 'ok'
      /** 實測維持熱量（卡/天） */
      maintenance: number
      /** ±1 標準誤差（殘差估） */
      low: number
      high: number
      /** 判斷要不要調整用的 1 個標準誤差（卡/天）：殘差估與理論估取大（spec「每日目標省心」） */
      se: number
      meanIntake: number
      /** 體重斜率，kg/週（負＝在掉） */
      slopeKgPerWeek: number
      loggedDays: number
      weighIns: number
      weightSpanDays: number
      /** 實際用的那一段（第一個到最後一個完整的日子，含） */
      from: string
      end: string
    }

/**
 * 把 intake 的原始列加總成每日合計。營養值是**單份快照**，要乘 qty（Today.tsx 渲染時也是
 * 這樣算）。數字欄位以字串回來也吃（PostgREST 的 numeric 可能是字串）。
 * 不做窗口過濾——那是 estimateMaintenance 的事，界只在一處。
 */
export function dailyKcalFromRows(
  rows: readonly { eaten_on: string; qty: number | string; kcal: number | string; meal: string }[],
): DailyKcal[] {
  const byDate = new Map<string, { kcal: number; meals: Set<string> }>()
  for (const r of rows) {
    const d = byDate.get(r.eaten_on) ?? { kcal: 0, meals: new Set<string>() }
    d.kcal += Number(r.kcal) * Number(r.qty)
    d.meals.add(r.meal)
    byDate.set(r.eaten_on, d)
  }
  return [...byDate].map(([date, d]) => ({ date, kcal: d.kcal, complete: d.meals.has('lunch') && d.meals.has('dinner') }))
}

/** 估計時的額外條件。trainingStart：第一筆訓練的日期；之後 SETTLE_DAYS 天的飲食與體重都不用。 */
export interface BaselineOptions {
  trainingStart?: string | null
}

interface DateRange {
  from: string
  end: string
}

function excludedRanges(opts: BaselineOptions): DateRange[] {
  return opts.trainingStart ? [{ from: opts.trainingStart, end: shiftDate(opts.trainingStart, SETTLE_DAYS - 1) }] : []
}

const inRanges = (date: string, ranges: readonly DateRange[]) => ranges.some((r) => date >= r.from && date <= r.end)

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

/** 兩個 yyyy-mm-dd 相差幾天（見 dayIndex：UTC 日界，不經本地時區的夏令時間）。 */
function daysBetween(from: string, to: string): number {
  return dayIndex(to) - dayIndex(from)
}

/**
 * 最新窗口的估計。endDate 是窗尾（含）——呼叫端傳「昨天」，今天還沒記完不算。
 * 窗口外的資料（含 endDate 之後）完全不參與。
 *
 * 只用窗口裡「完整記錄最多的一連串」（同分取較近的），不是整窗：整天沒記的日子多半是吃得多的外食、聚餐，
 * 不在平均裡卻照樣推高體重斜率（修 ②）。最近 RECENT_DAYS 天完整不到 recentDays 就暫停（修 ③），
 * 開始訓練後 SETTLE_DAYS 天的資料不用（修 ④）。
 */
export function estimateMaintenance(
  dailyKcal: readonly DailyKcal[],
  weights: readonly WeightPoint[],
  endDate: string,
  opts: BaselineOptions = {},
): BaselineResult {
  const start = windowStart(endDate)
  const ex = excludedRanges(opts)
  const daily = dailyKcal.filter((d) => !inRanges(d.date, ex))
  const wts = weights.filter((w) => !inRanges(w.date, ex))
  /* 最近一週用**沒排除的**記錄數：排除是因為那幾週的體重不可信，不是人沒記——用排除後的數，天天記的人會被說
     「最近 7 天完整記錄還差 N 天」（v2.137 review）。 */
  const recentFrom = shiftDate(endDate, -(RECENT_DAYS - 1))
  const recentDays = new Set(dailyKcal.filter((d) => d.complete && d.date >= recentFrom && d.date <= endDate).map((d) => d.date)).size
  /* 剛開始訓練：最快哪一天算得出來＝排除段最後一天再過 loggedDays 天（之後每天都記完整，才湊得出一串）。
     只看「窗尾在不在排除段裡」會早報約三週，排除段一結束還會改口叫人「接回記錄」（v2.137 review）。 */
  const settlingUntil =
    ex.map((r) => ({ r, until: shiftDate(r.end, BASELINE_NEEDS.loggedDays) })).find(({ r, until }) => endDate >= r.from && endDate < until)?.until ?? null
  const winSpread = segmentSpread(wts.filter((w) => w.date >= start && w.date <= endDate))

  const runs = loggedRuns(daily, start, endDate)
  let best: LoggedRun | null = null
  // runs 由舊到新；同分時換成後者＝取較近的
  for (const run of runs) if (best === null || run.loggedDays >= best.loggedDays) best = run
  const r = best === null ? null : estimateOnSpan(daily, wts, best.from, best.end)
  if (r !== null && r.status === 'ok' && recentDays >= BASELINE_NEEDS.recentDays) return r
  if (r !== null && r.status === 'implausible') return r
  /* 算不出來時，體重筆數與跨度報哪一份：那一串的記錄已經夠了，缺的就是那一串裡的體重；記錄都還不夠時報整個窗口的——
     否則體重量在另一串裡的人會被說「體重還差 4 筆」（v2.137 review）。 */
  const enough = r !== null && r.loggedDays >= BASELINE_NEEDS.loggedDays ? r : null
  return {
    status: 'insufficient',
    loggedDays: r?.loggedDays ?? 0,
    weighIns: enough ? enough.weighIns : winSpread.usable,
    weightSpanDays: enough ? enough.weightSpanDays : winSpread.span,
    recentDays,
    settlingUntil,
  }
}

/** 一串日期裡最早與最晚相差幾天；不足 2 個為 0 */
function spanDays(dates: readonly string[]): number {
  if (dates.length < 2) return 0
  const xs = dates.map(dayIndex)
  return Math.max(...xs) - Math.min(...xs)
}

type SpanResult =
  | Exclude<BaselineResult, { status: 'insufficient' }>
  | Omit<Extract<BaselineResult, { status: 'insufficient' }>, 'recentDays' | 'settlingUntil'>

/**
 * 任意一段 [startDate, endDate]（含）的估計。最新窗口是固定 28 天；回溯時用的是「一連串記錄」
 * 的整段，長度不一——所以把算法與窗口長度拆開。範圍外的攝取與體重完全不參與。
 */

function estimateOnSpan(
  dailyKcal: readonly DailyKcal[],
  weights: readonly WeightPoint[],
  startDate: string,
  endDate: string,
): SpanResult {
  const inWindow = (date: string) => date >= startDate && date <= endDate

  // 同一天若重複，後者覆蓋前者；呼叫端本來就該給每日合計，這裡不替它加總第二次
  const byDate = new Map<string, DailyKcal>()
  for (const d of dailyKcal) if (inWindow(d.date)) byDate.set(d.date, d)
  const logged = [...byDate.values()].filter((d) => d.complete).map((d) => d.kcal)

  const inSpan = weights.filter((w) => inWindow(w.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const segs = segmentIds(inSpan)
  const pts = inSpan.map((w, i) => ({ x: daysBetween(startDate, w.date), y: w.kg, seg: segs[i] }))
  const { usable, span } = segmentSpread(inSpan)

  if (
    logged.length < BASELINE_NEEDS.loggedDays ||
    usable < BASELINE_NEEDS.weighIns ||
    span < BASELINE_NEEDS.weightSpanDays
  ) {
    return { status: 'insufficient', loggedDays: logged.length, weighIns: usable, weightSpanDays: span }
  }

  const meanIntake = logged.reduce((s, k) => s + k, 0) / logged.length

  const n = pts.length
  const { slope, sxx, sse, k } = segmentedFit(pts) // slope：kg/天
  // 自由度＝筆數 − 截距數 − 斜率；只有一段時就是原本的 n − 2
  const slopeSe = Math.sqrt(sse / (n - k - 1) / sxx)

  const maintenance = meanIntake - slope * KCAL_PER_KG
  const slopeKgPerWeek = slope * 7
  const nonFinite = !Number.isFinite(maintenance) || !Number.isFinite(slopeKgPerWeek)
  const slopeOut = Math.abs(slopeKgPerWeek) > MAX_PLAUSIBLE_KG_PER_WEEK
  const rangeOut = maintenance < PLAUSIBLE_MAINTENANCE.min || maintenance > PLAUSIBLE_MAINTENANCE.max
  if (nonFinite || slopeOut || rangeOut) {
    // 斜率先判：體重走勢離譜時，維持熱量落界外只是它的後果，要叫人查的是體重
    const reason = nonFinite ? 'non-finite' : slopeOut ? 'slope' : 'range'
    return { status: 'implausible', maintenance, slopeKgPerWeek, reason }
  }

  const half = slopeSe * KCAL_PER_KG
  // 假設每天的波動互相獨立；實際會連續幾天偏高或偏低，真實誤差更大
  const theorySe = (WEIGHT_SD_KG / Math.sqrt(sxx)) * KCAL_PER_KG
  return {
    status: 'ok',
    maintenance,
    low: maintenance - half,
    high: maintenance + half,
    se: Math.max(half, theorySe),
    meanIntake,
    slopeKgPerWeek,
    loggedDays: logged.length,
    weighIns: n,
    weightSpanDays: span,
    from: startDate,
    end: endDate,
  }
}

/**
 * 照 targetKcal 吃，預期每週體重變化（kg）：負＝會瘦、正＝會胖。
 * 跟 computeTargets 的 dailyDelta 是同一個換算的反方向。
 */
export function expectedWeeklyChangeKg(maintenance: number, targetKcal: number): number {
  return ((targetKcal - maintenance) * 7) / KCAL_PER_KG
}

/** 距上次變動（measured_tdee_on）不到這麼多天就不自動也不問。MacroFactor、Carbon 都是每週 check-in 一次。 */
export const ADJUST_COOLDOWN_DAYS = 7

export interface AdviceContext {
  /** 目標實際用的維持熱量 */
  inUseTdee: number
  /** 用的是公式（measured_tdee 是 null）：第一次換成回推一律問 */
  usingFormula: boolean
  /** 上次變動日（measured_tdee_on）；沒變過是 null */
  changedOn: string | null
  today: string
  bmr: number | null
  /** 每日目標 − 維持熱量（減重是負的）：維持熱量換成 next 之後，目標＝next ＋ 這個 */
  targetOffset: number
}

/** 每日目標該怎麼處理最新回推（spec.md「每日目標省心：小改自動、大改才問」）：lacking＝最新窗口記錄不夠；
 *  suspect＝算出來不可能是真的；same＝不動；auto＝自動往回推值移一半；ask＝差太多或第一次從公式換過去，要人判斷。
 *  **只吃最新窗口**：回溯到的舊一段不反映現在，不能改用。next＝這次要寫入的值（一律只移一半，三種都帶：
 *  按「改用」、自己點紀錄回推那一列寫的也是它）。1 SE、2 SE 是統計慣例、移一半取自 MacroFactor 範例的中間值，
 *  三個都是可調的設計決定，不是研究給的界線。 */
export type MaintenanceAdvice =
  | { kind: 'lacking'; result: Extract<BaselineResult, { status: 'insufficient' }> }
  | { kind: 'suspect'; result: Extract<BaselineResult, { status: 'implausible' }> }
  | { kind: 'same' | 'auto' | 'ask'; result: Extract<BaselineResult, { status: 'ok' }>; next: number }

export function maintenanceAdvice(current: BaselineResult, ctx: AdviceContext): MaintenanceAdvice {
  if (current.status === 'insufficient') return { kind: 'lacking', result: current }
  if (current.status === 'implausible') return { kind: 'suspect', result: current }
  // 比捨入後的整數：存的是整數，不捨入的話差距剛好等於 1 SE 這種邊界永遠碰不到，按完也可能馬上又被判成要動
  const inUse = Math.round(ctx.inUseTdee)
  const d = Math.round(current.maintenance) - inUse
  const se = Math.round(current.se)
  // 夾在資料庫 check 的範圍內：公式值離譜時移一半也可能出界，存檔會被擋（review LOW）
  const next = Math.min(PLAUSIBLE_MAINTENANCE.max, Math.max(PLAUSIBLE_MAINTENANCE.min, Math.round(inUse + d / 2)))
  const kind = (k: 'same' | 'auto' | 'ask') => ({ kind: k, result: current, next })
  // 還原完、改回公式完也算變動：不擋的話下次開 App 又被調回去
  if (ctx.changedOn !== null && daysBetween(ctx.changedOn, ctx.today) < ADJUST_COOLDOWN_DAYS) return kind('same')
  if (Math.abs(d) <= se) return kind('same')
  // 換算法不是小調：公式和回推可能差幾百卡
  if (ctx.usingFormula) return kind('ask')
  // 差這麼多，比較可能是漏記、秤或身體真的變了
  if (Math.abs(d) > 2 * se) return kind('ask')
  // 只擋往下調：目標本來就低於 BMR 時，往上調是往安全的方向，不用問（review MEDIUM）
  if (d < 0 && ctx.bmr !== null && next + ctx.targetOffset < ctx.bmr) return kind('ask')
  return kind('auto')
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

/** 把完整的日子串成「連串記錄」，漏記不超過 MAX_RUN_GAP_DAYS 天視為同一串。 */
function loggedRuns(dailyKcal: readonly DailyKcal[], from: string, end: string): LoggedRun[] {
  const days = [...new Set(dailyKcal.filter((d) => d.date >= from && d.date <= end && d.complete).map((d) => d.date))].sort()
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
  opts: BaselineOptions = {},
): { current: BaselineResult; shown: ShownBaseline | null } {
  const win = baselineWindow(today)
  const current = estimateMaintenance(dailyKcal, weights, win.end, opts)
  if (current.status === 'ok') return { current, shown: { result: current, from: current.from, end: current.end, stale: false } }
  if (current.status === 'implausible') return { current, shown: null }

  // 回溯（含最新窗口暫停時「沿用舊值」）：開始訓練後的那段一樣不用
  const ex = excludedRanges(opts)
  const daily = dailyKcal.filter((d) => !inRanges(d.date, ex))
  const wts = weights.filter((w) => !inRanges(w.date, ex))
  const { from: horizon } = baselineFetchRange(today)
  const runs = loggedRuns(daily, horizon, win.end)
  let best: ShownBaseline | null = null
  // 由近到遠走，只在「嚴格更多」時才換，所以同分自然留下較近的
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]
    if (run.loggedDays < BASELINE_NEEDS.loggedDays) continue
    const r = estimateOnSpan(daily, wts, run.from, run.end)
    if (r.status !== 'ok') continue
    if (best === null || r.loggedDays > best.result.loggedDays) {
      best = { result: r, from: run.from, end: run.end, stale: true }
    }
  }
  return { current, shown: best }
}

/** 資料不足時缺哪一項。畫面依 kind 各自組文案（長版／短版），判定只在 insufficientShortfalls 寫一次。 */
export type BaselineShortfall =
  | { kind: 'settling'; until: string }
  | { kind: 'loggedDays'; have: number; need: number }
  | { kind: 'weighIns'; have: number; need: number }
  | { kind: 'weightSpanDays'; have: number; need: number }
  | { kind: 'recentDays'; have: number; need: number }

/** 缺的項目，順序固定：剛開始訓練、記錄天數、體重筆數、體重跨度、最近一週。**跨度只在筆數夠了才算缺**——筆數不夠時
 *  跨度必然也不夠（不足 2 筆算 0），兩句並列只是把同一件事講兩遍。 */
export function insufficientShortfalls(r: Extract<BaselineResult, { status: 'insufficient' }>): BaselineShortfall[] {
  const out: BaselineShortfall[] = []
  if (r.settlingUntil !== null) out.push({ kind: 'settling', until: r.settlingUntil })
  if (r.loggedDays < BASELINE_NEEDS.loggedDays) out.push({ kind: 'loggedDays', have: r.loggedDays, need: BASELINE_NEEDS.loggedDays })
  if (r.weighIns < BASELINE_NEEDS.weighIns) out.push({ kind: 'weighIns', have: r.weighIns, need: BASELINE_NEEDS.weighIns })
  else if (r.weightSpanDays < BASELINE_NEEDS.weightSpanDays) out.push({ kind: 'weightSpanDays', have: r.weightSpanDays, need: BASELINE_NEEDS.weightSpanDays })
  if (r.recentDays < BASELINE_NEEDS.recentDays) out.push({ kind: 'recentDays', have: r.recentDays, need: BASELINE_NEEDS.recentDays })
  return out
}
