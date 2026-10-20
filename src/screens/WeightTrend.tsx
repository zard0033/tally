/* 體重趨勢獨立頁（spec.md「體重趨勢圖」）。兩張圖：體重（每次量測的點＋7 日平均線）、體脂，
   共用 X 軸與十字線（recharts 的 syncId，兩張吃同一份 points 所以索引對得上）。
   浮動 tooltip 只掛在體重圖上、列出三個值；體脂圖的 tooltip 內容是空的，指標在體脂圖上移動時
   同步出現在體重圖的那一個——「一個 tooltip 列全部系列」，不會兩個框疊在一起。
   運算在 src/lib/weightTrend.ts；這裡只管畫。本頁是 lazy chunk（recharts 不進主 bundle）。 */
import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import SegmentedControl from '@/components/SegmentedControl'
import { listWeights, type Weight } from '@/lib/api'
import { localDate, monthDay } from '@/lib/dates'
import { isoOfDay, niceDomain, TREND_RANGES, trendPoints, xDomain, xTicks, yTicks, type TrendPoint, type TrendRange } from '@/lib/weightTrend'

/** 「全部」要撈完整歷史：listWeights 預設只給 90 筆。1000 是 Supabase 單次回應上限。 */
const FULL_HISTORY = 1000

export interface WeightTrendProps {
  weights: Weight[] | null
  onBack: () => void
}

const fmt1 = (n: number) => n.toFixed(1)

/** 浮動讀數：值在前（粗）、名稱在後（淡）；體脂沒填寫「—」。 */
function TrendTip({ active, payload }: TooltipContentProps) {
  const p = payload?.[0]?.payload as TrendPoint | undefined
  if (!active || !p) return null
  return (
    <div className="trend-tip" role="status">
      <div className="trend-tip-date">{monthDay(p.date)}</div>
      <div className="trend-tip-row"><b>{fmt1(p.kg)} kg</b><span>當次量測</span></div>
      <div className="trend-tip-row"><b>{fmt1(p.avg)} kg</b><span>7 日平均</span></div>
      <div className="trend-tip-row"><b>{p.fat === null ? '—' : `${fmt1(p.fat)} %`}</b><span>體脂</span></div>
    </div>
  )
}

export default function WeightTrend({ weights, onBack }: WeightTrendProps) {
  const [range, setRange] = useState<TrendRange>('90')
  const [full, setFull] = useState<Weight[] | null>(null)
  const today = useMemo(() => localDate(), [])

  /* 自己撈完整歷史；撈不到（離線、伺服器錯誤）就退回設定頁傳進來的那份，圖不空。 */
  useEffect(() => {
    let alive = true
    listWeights(FULL_HISTORY).then((r) => alive && setFull(r)).catch(() => {})
    return () => { alive = false }
  }, [])

  const source = full ?? weights
  const points = useMemo(() => (source ? trendPoints(source, range, today) : []), [source, range, today])
  const dom = useMemo(() => xDomain(points, range, today), [points, range, today])
  const ticks = useMemo(() => (dom ? xTicks(dom[0], dom[1]) : []), [dom])
  const kgDomain = useMemo(() => niceDomain(points.flatMap((p) => [p.kg, p.avg]), 0.3, 1), [points])
  const fatPoints = points.filter((p) => p.fat !== null)
  const fatDomain = useMemo(() => niceDomain(fatPoints.map((p) => p.fat as number), 0.5, 1), [fatPoints])
  const last = points[points.length - 1]

  const axis = {
    type: 'number' as const, dataKey: 't', domain: dom ?? ['auto', 'auto'] as [string, string], ticks,
    tickFormatter: (t: number) => monthDay(isoOfDay(t)), tickLine: false, axisLine: { stroke: 'var(--rule)' },
  }

  /* 7 日平均線只在最後一點畫端點與數字；其餘不畫點（每個點都標數字是 dataviz 的反例）。 */
  const endDot = (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props
    if (index !== points.length - 1 || cx === undefined || cy === undefined) return <g key={index} />
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={4} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
        <text className="trend-endlabel" x={cx} y={cy - 10} textAnchor="end">{fmt1(last.avg)}</text>
      </g>
    )
  }

  let body
  if (source === null) {
    body = <div className="trend-skel" aria-busy="true" aria-label="載入中" />
  } else if (source.length === 0) {
    body = <p className="trend-empty">還沒有體重紀錄</p>
  } else if (points.length === 0) {
    body = (
      <p className="trend-empty">
        這段期間沒有紀錄
        <button type="button" className="trend-link" onClick={() => setRange('all')}>看全部</button>
      </p>
    )
  } else {
    body = (
      <>
        <section className="trend-card" aria-label="體重">
          <div className="trend-head">
            <h2>體重 <small>kg</small></h2>
            <ul className="trend-legend">
              <li><i className="k-dot" aria-hidden="true" />每次量測</li>
              <li><i className="k-line" aria-hidden="true" />7 日平均</li>
            </ul>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={points} syncId="weight-trend" margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--rule-subtle)" />
              <XAxis {...axis} />
              <YAxis width={36} domain={kgDomain} ticks={yTicks(kgDomain)} tickLine={false} axisLine={false} />
              <Tooltip content={TrendTip} cursor={{ stroke: 'var(--ink-faint)', strokeWidth: 1 }} isAnimationActive={false} />
              <Line dataKey="kg" name="當次量測" stroke="none" dot={{ r: 3, fill: 'var(--ink-faint)', stroke: 'none' }} activeDot={false} isAnimationActive={false} />
              <Line dataKey="avg" name="7 日平均" type="monotone" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                dot={endDot} activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        {fatPoints.length > 0 ? (
          <section className="trend-card" aria-label="體脂">
            <div className="trend-head"><h2>體脂 <small>%</small></h2></div>
            <ResponsiveContainer width="100%" height={140}>
              <ComposedChart data={points} syncId="weight-trend" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--rule-subtle)" />
                <XAxis {...axis} />
                <YAxis width={36} domain={fatDomain} ticks={yTicks(fatDomain)} tickLine={false} axisLine={false} />
                <Tooltip content={() => null} cursor={{ stroke: 'var(--ink-faint)', strokeWidth: 1 }} isAnimationActive={false} />
                <Line dataKey="fat" name="體脂" connectNulls stroke="var(--ink-muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                  dot={{ r: 4, fill: 'var(--ink-muted)', stroke: 'var(--card)', strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: 'var(--ink-muted)', stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </section>
        ) : (
          <p className="trend-empty">這段期間沒有體脂紀錄</p>
        )}

        <section className="trend-card" aria-label="明細">
          <table className="trend-table">
            <caption className="sr-only">體重與體脂明細，新到舊</caption>
            <thead><tr><th scope="col">日期</th><th scope="col">體重</th><th scope="col">體脂</th></tr></thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.date}>
                  <th scope="row">{p.date.slice(0, 4) === today.slice(0, 4) ? monthDay(p.date) : p.date.replace(/-/g, '/')}</th>
                  <td>{fmt1(p.kg)} kg</td>
                  <td>{p.fat === null ? '—' : `${fmt1(p.fat)} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </>
    )
  }

  return (
    <div className="main" data-screen="weight-trend">
      <div className="lib-topbar">
        <button className="icon-btn" type="button" aria-label="返回設定" onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h1>體重趨勢</h1>
      </div>
      <div className="trend-scroll">
        <SegmentedControl label="範圍" items={TREND_RANGES} value={range} onPick={setRange} className="trend-range" />
        {body}
      </div>
    </div>
  )
}
