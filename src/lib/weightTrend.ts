/* 體重趨勢圖（spec.md「體重趨勢圖」）的純運算：7 日平均、範圍切片、軸範圍與刻度。
   不沾 DOM、不碰 recharts——圖怎麼畫是 WeightTrend.tsx 的事，這裡只管數字對不對。 */
import { dayIndex, monthDay, shiftDate } from './dates'
import { num } from './formulas'

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
}

export interface TrendPoint {
  /** yyyy-mm-dd */
  date: string
  /** 自 1970-01-01 起算的天數；X 軸用數字軸，缺記錄的日子才會留白而不是被擠在一起 */
  t: number
  kg: number
  /** 7 日平均 */
  avg: number
  fat: number | null
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
 * 全部量測 → 趨勢點（由舊到新）。7 日平均＝該天往前 7 個日曆日（含當天）內所有量測的平均，
 * 不是「最近 7 筆」——記錄不是每天都有。平均先對全部歷史算、再切範圍，所以範圍第一天的窗口是完整的。
 * 體重不是有限數字的列整筆丟掉（不畫比畫錯好）；體脂不是有限數字就當沒填。
 */
export function trendPoints(rows: TrendRow[], range: TrendRange, today: string): TrendPoint[] {
  const all = rows
    .map((r) => ({ date: r.measured_on, t: dayIndex(r.measured_on), kg: num(r.weight_kg), fat: num(r.body_fat_pct) }))
    .filter((r) => Number.isFinite(r.kg))
    .sort((a, b) => a.t - b.t)
  const from = rangeStart(range, today)
  return all
    .map((r) => {
      const win = all.filter((x) => x.t <= r.t && x.t > r.t - 7)
      return {
        date: r.date,
        t: r.t,
        kg: r.kg,
        avg: win.reduce((s, x) => s + x.kg, 0) / win.length,
        fat: Number.isFinite(r.fat) ? r.fat : null,
      }
    })
    .filter((p) => from === null || p.date >= from)
}

/** X 軸範圍：固定範圍＝[起點, 今天]，圖的右緣永遠是今天；全部＝[第一筆, 今天]。沒有資料回 null。 */
export function xDomain(points: readonly { t: number }[], range: TrendRange, today: string): [number, number] | null {
  if (points.length === 0) return null
  const end = Math.max(dayIndex(today), points[points.length - 1].t)
  const from = rangeStart(range, today)
  return [from === null ? points[0].t : dayIndex(from), end]
}

/** 在 [t0, t1] 上取 n 個等距刻度（含兩端）；範圍只有一天就一個。 */
export function xTicks(t0: number, t1: number, n = 4): number[] {
  if (t1 <= t0) return [t0]
  return Array.from({ length: n }, (_, i) => Math.round(t0 + ((t1 - t0) * i) / (n - 1)))
}

/** Y 軸刻度：範圍 ≤6 每 1、≤12 每 2、≤30 每 5、更大每 10，只落在步長的整數倍上（約 3–7 條格線）。 */
export function yTicks([lo, hi]: [number, number]): number[] {
  const span = hi - lo
  const step = span <= 6 ? 1 : span <= 12 ? 2 : span <= 30 ? 5 : 10
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

/** 趨勢圖的 X 軸設定（recharts 的 XAxis props）：t 是日序，刻度顯示月/日。Analysis 與 WeightTrend 共用。 */
export const trendXAxis = (dom: [number, number] | null, ticks: number[]) => ({
  type: 'number' as const, dataKey: 't', domain: dom ?? ['auto', 'auto'] as [string, string], ticks,
  tickFormatter: (t: number) => monthDay(isoOfDay(t)), tickLine: false, axisLine: { stroke: 'var(--rule)' },
})

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
