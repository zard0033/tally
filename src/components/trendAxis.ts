import { trendTickLabel } from '@/lib/weightTrend'

/** 趨勢圖的 X 軸設定（recharts 的 XAxis props）。Analysis 與 WeightTrend 共用，兩張圖的軸不該分岔。 */
export const trendXAxis = (dom: [number, number] | null, ticks: number[]) => ({
  type: 'number' as const, dataKey: 't', domain: dom ?? ['auto', 'auto'] as [string, string], ticks,
  tickFormatter: trendTickLabel, tickLine: false, axisLine: { stroke: 'var(--rule)' },
})
