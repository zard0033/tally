/* 體重趨勢圖（spec.md「體重趨勢圖」）的純運算：趨勢（指數平滑）、範圍切片、軸範圍與刻度。
   不沾 DOM、不碰 recharts——圖怎麼畫是 WeightTrend.tsx 的事，這裡只管數字對不對。 */
import { dayIndex, monthDay, shiftDate } from './dates'
import { num } from './formulas'
import { segmentIds } from './baseline'

export type TrendRange = '30' | '90' | 'all'

export const TREND_RANGES: { key: TrendRange; label: string }[] = [
  { key: '30', label: '30 天' },
  { key: '90', label: '90 天' },
  { key: 'all', label: '全部' },
]

export interface TrendRow {
  weight_kg: number | string
  measured_on: string
  body_fat_pct: number | string | null
  /** 體脂量法斷點（v2.138；v2.146 起只切體脂）：舊資料或 stub 沒這欄就當沒有 */
  method_break?: boolean | null
}

export interface TrendPoint {
  /** yyyy-mm-dd */
  date: string
  /** 自 1970-01-01 起算的天數；X 軸用數字軸，缺記錄的日子才會留白而不是被擠在一起 */
  t: number
  kg: number
  /** 體重趨勢（指數平滑，見 TREND_SMOOTHING）；體重不看量法斷點 */
  trend: number
  fat: number | null
  /** 體脂趨勢（同一種平滑，在量法斷點重新起算）；這一筆沒填體脂、或這一段還沒有體脂時是 null */
  fatTrend: number | null
  /** 這筆是體脂量法斷點（換了之後的第一筆） */
  brk: boolean
  /** 體脂的段號：斷點切出來的第幾段，由舊到新 */
  seg: number
}

/**
 * 平滑常數：The Hacker's Diet 的指數平滑移動平均，每天舊趨勢留 0.9、新讀數佔 0.1（約等於 20 天簡單平均的延遲）。
 * https://www.fourmilab.ch/hackdiet/e4/signalnoise.html 。量測不是每天有：隔 d 天的一筆佔 1 − 0.9^d，
 * 等於中間那幾天都量到同一個值——一週量一次時 7 日平均幾乎就是原始讀數，線會跟著每一筆抖（v2.146）。
 */
export const TREND_SMOOTHING = 0.9

/** 指數平滑（由舊到新）：第一筆就是起點；reset 為真的那一筆重新起算。 */
function smooth(xs: readonly { t: number; v: number; reset: boolean }[]): number[] {
  let tr = NaN
  let prevT = 0
  return xs.map((x, i) => {
    tr = i === 0 || x.reset ? x.v : tr + (1 - TREND_SMOOTHING ** (x.t - prevT)) * (x.v - tr)
    prevT = x.t
    return tr
  })
}

/** dayIndex 的反運算。 */
export function isoOfDay(t: number): string {
  const d = new Date(t * 86400000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/** 範圍起點（含）：今天往前數，「30 天」＝今天加前 29 天；全部＝不設下界。 */
export function rangeStart(range: TrendRange, today: string): string | null {
  return range === 'all' ? null : shiftDate(today, -(Number(range) - 1))
}

/**
 * 全部量測 → 趨勢點（由舊到新）。趨勢先對全部歷史算、再切範圍，所以範圍第一天的趨勢已經走穩。
 * 量法斷點只切體脂（v2.146）：換電池後體脂整段平移約 2%，體重看不出平移（2026-11-20 實際資料），
 * 體重照常連續。體重不是有限數字的列整筆丟掉（不畫比畫錯好）；體脂不是有限數字就當沒填。
 */
export function trendPoints(rows: TrendRow[], range: TrendRange, today: string): TrendPoint[] {
  const sorted = rows
    .map((r) => ({ date: r.measured_on, t: dayIndex(r.measured_on), kg: num(r.weight_kg), fat: num(r.body_fat_pct), brk: r.method_break === true }))
    .filter((r) => Number.isFinite(r.kg))
    .sort((a, b) => a.t - b.t)
  const segs = segmentIds(sorted)
  const trend = smooth(sorted.map((r) => ({ t: r.t, v: r.kg, reset: false })))
  // 體脂只拿有填的列平滑，斷點後的第一筆體脂重新起算（斷點那天沒填體脂的話，從之後第一筆有填的起算）
  const withFat = sorted.map((r, i) => ({ ...r, seg: segs[i] })).filter((r) => Number.isFinite(r.fat))
  const fatTr = smooth(withFat.map((r, i) => ({ t: r.t, v: r.fat, reset: i > 0 && r.seg !== withFat[i - 1].seg })))
  const fatByDate = new Map(withFat.map((r, i) => [r.date, fatTr[i]]))
  const from = rangeStart(range, today)
  return sorted
    .map((r, i) => ({
      date: r.date,
      t: r.t,
      kg: r.kg,
      trend: trend[i],
      fat: Number.isFinite(r.fat) ? r.fat : null,
      fatTrend: fatByDate.get(r.date) ?? null,
      brk: r.brk,
      seg: segs[i],
    }))
    .filter((p) => from === null || p.date >= from)
}

/** X 軸範圍：固定範圍＝[起點, 今天]，圖的右緣永遠是今天；全部＝[第一筆, 今天]。沒有資料回 null。 */
export function xDomain(points: readonly { t: number }[], range: TrendRange, today: string): [number, number] | null {
  if (points.length === 0) return null
  const end = Math.max(dayIndex(today), points[points.length - 1].t)
  const from = rangeStart(range, today)
  return [from === null ? points[0].t : dayIndex(from), end]
}

/**
 * Y 軸範圍，至少跨 minSpan（v2.146）：體重一天上下 1 kg 是常態（水分、吃了什麼），軸只照資料撐的話，
 * 一段持平的資料會被拉滿整張圖，1 kg 的起伏看起來像大浪。資料夠寬時同 niceDomain；不夠寬時以資料中點為中心撐開。
 */
export function spanDomain(values: number[], pad: number, step: number, minSpan: number): [number, number] {
  if (values.length === 0) return [0, 1]
  const [lo, hi] = niceDomain(values, pad, step)
  if (hi - lo >= minSpan) return [lo, hi]
  const mid = (Math.min(...values) + Math.max(...values)) / 2
  const nlo = Math.floor((mid - minSpan / 2) / step) * step
  return [nlo, Math.max(nlo + minSpan, Math.ceil((mid + minSpan / 2) / step) * step)]
}

/** 在 [t0, t1] 上取 n 個等距刻度（含兩端）；範圍只有一天就一個。 */
export function xTicks(t0: number, t1: number, n = 4): number[] {
  if (t1 <= t0) return [t0]
  return Array.from({ length: n }, (_, i) => Math.round(t0 + ((t1 - t0) * i) / (n - 1)))
}

/** Y 軸刻度：範圍 ≤6 每 1、≤12 每 2、≤30 每 5、更大每 10，只落在步長的整數倍上（約 3–7 條格線）；minStep 給矮的小圖用。 */
export function yTicks([lo, hi]: [number, number], minStep = 1): number[] {
  const span = hi - lo
  const step = Math.max(minStep, span <= 6 ? 1 : span <= 12 ? 2 : span <= 30 ? 5 : 10)
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v)
  return out
}

/** Y 軸範圍：資料上下各留 pad，再對齊到 step 的整數倍，刻度才會落在乾淨的數字上。沒有資料回 [0, 1]。 */
export function niceDomain(values: number[], pad: number, step: number): [number, number] {
  if (values.length === 0) return [0, 1]
  const lo = Math.floor((Math.min(...values) - pad) / step) * step
  const hi = Math.ceil((Math.max(...values) + pad) / step) * step
  return [lo, hi]
}

/** 趨勢圖 X 軸的刻度文字：t 是日序，顯示月/日。 */
export const trendTickLabel = (t: number): string => monthDay(isoOfDay(t))

/** 趨勢圖的數值顯示：一位小數。 */
export const fmt1 = (n: number) => n.toFixed(1)

/** sparkline 用：weight_kg 折線，寬 120 高 32 的 viewBox 內線性映射（y 留上下各 4）。
 *  少於 2 筆畫不出線，呼叫端自己判斷要不要渲染。 */
export function sparklinePoints(weights: Pick<TrendRow, 'weight_kg'>[]): string {
  const values = weights.map((w) => Number(w.weight_kg))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = values.length > 1 ? 120 / (values.length - 1) : 0
  return values.map((v, i) => `${(i * stepX).toFixed(1)},${(28 - ((v - min) / span) * 24).toFixed(1)}`).join(' ')
}

/** 記體重時體脂率可接受的範圍（%）。 */
export const BODY_FAT_MIN = 3
export const BODY_FAT_MAX = 70

/** 體重要是大於 0 的有限數字。 */
export const isValidWeightKg = (kg: number): boolean => Number.isFinite(kg) && kg > 0

/** 體脂率要是 BODY_FAT_MIN–BODY_FAT_MAX 之間的有限數字（留空由呼叫端處理，不在這裡判）。 */
export const isValidBodyFatPct = (fat: number): boolean => Number.isFinite(fat) && fat >= BODY_FAT_MIN && fat <= BODY_FAT_MAX

/** 這段變化最少要跨幾天：一週以內的差幾乎全是水分與量測時間的差。 */
export const PACE_MIN_SPAN_DAYS = 7

/** 照計畫，到 t 那天該在幾公斤（計畫線上的值）；從範圍內第一點的趨勢起算。 */
export function planAt(points: readonly { t: number; trend: number }[], perWeek: number, t: number): number | null {
  const first = points[0]
  return first === undefined ? null : first.trend + (perWeek / 7) * (t - first.t)
}

/**
 * 計畫線：從範圍內第一點的趨勢起，照 perWeek 的速度走（現在設定的速度；之前改過速度的話，舊的那段不照舊速度畫）。
 * 每一點多一個 plan 值給圖畫線；perWeek 是 null（自訂目標）就不畫。
 */
export function withPlan<T extends { t: number; trend: number }>(points: readonly T[], perWeek: number | null): (T & { plan: number | null })[] {
  return points.map((p) => ({ ...p, plan: perWeek === null ? null : planAt(points, perWeek, p.t) }))
}

/** 變化量的寫法：帶正負號（減號用 −）、一位小數；捨入到 0 寫 ±0.0。 */
export function signed1(n: number): string {
  const v = Math.round(n * 10) / 10
  return v === 0 ? '±0.0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`
}
