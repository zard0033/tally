/* 訓練分析整頁（階段 4 A，樣張 `_design-sample/analysis.html`）：動作進度——列出有已打勾組的動作，
   點進單一動作看 e1RM 折線、歷來最佳與逐次明細。肌群狀態（C）之後才加，現在沒有第二段、也不放分段控制。
   運算在 src/lib/strength.ts；這裡只管畫。本頁是 lazy chunk（recharts 不進主 bundle）。
   整頁接管畫面（同動作庫、訓練中），進出時 Training 通知 App 收起底部列。 */
import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import SegmentedControl from '@/components/SegmentedControl'
import { localDate, monthDay } from '@/lib/dates'
import { bestE1rm, chartPoints, progressList, strengthHistory, type ChartPoint } from '@/lib/strength'
import { formatKg, type TrainingDb } from '@/lib/training'
import { isoOfDay, niceDomain, TREND_RANGES, xDomain, xTicks, yTicks, type TrendRange } from '@/lib/weightTrend'

interface AnalysisProps {
  db: TrainingDb
  onBack: () => void
}

const fmt1 = (n: number) => n.toFixed(1)

const BackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 6l-6 6 6 6" />
  </svg>
)

/** 浮動讀數：值在前（粗）、名稱在後（淡）。 */
function StrengthTip({ active, payload }: TooltipContentProps) {
  const p = payload?.[0]?.payload as ChartPoint | undefined
  if (!active || !p) return null
  return (
    <div className="trend-tip" role="status">
      <div className="trend-tip-date">{monthDay(p.date)}</div>
      <div className="trend-tip-row"><b>{fmt1(p.e1rm)} kg</b><span>e1RM 估算</span></div>
      <div className="trend-tip-row"><b>{formatKg(p.topSet.weight_kg)} × {p.topSet.reps}</b><span>最重一組</span></div>
    </div>
  )
}

function ExerciseProgress({ db, exerciseId, name, onBack }: { db: TrainingDb; exerciseId: string; name: string; onBack: () => void }) {
  const [range, setRange] = useState<TrendRange>('90')
  const today = useMemo(() => localDate(), [])
  const history = useMemo(() => strengthHistory(db, exerciseId), [db, exerciseId])
  const points = useMemo(() => chartPoints(history, range, today), [history, range, today])
  const dom = useMemo(() => xDomain(points, range, today), [points, range, today])
  const ticks = useMemo(() => (dom ? xTicks(dom[0], dom[1]) : []), [dom])
  const yDomain = useMemo(() => niceDomain(points.map((p) => p.e1rm), 2, 5), [points])
  const last = points[points.length - 1]
  const best = bestE1rm(history)
  const latest = history[history.length - 1]

  const axis = {
    type: 'number' as const, dataKey: 't', domain: dom ?? ['auto', 'auto'] as [string, string], ticks,
    tickFormatter: (t: number) => monthDay(isoOfDay(t)), tickLine: false, axisLine: { stroke: 'var(--rule)' },
  }

  /* 每次訓練一個點（點少），只在最後一點標數字，其餘靠十字線讀。 */
  const dot = (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props
    if (cx === undefined || cy === undefined) return <g key={index} />
    const isLast = index === points.length - 1
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={isLast ? 5 : 4} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
        {isLast && <text className="trend-endlabel" x={cx} y={cy - 12} textAnchor={points.length > 1 ? 'end' : 'middle'}>{fmt1(last.e1rm)}</text>}
      </g>
    )
  }

  return (
    <div className="main" data-screen="analysis-exercise">
      <div className="lib-topbar">
        <button className="icon-btn" type="button" aria-label="返回訓練分析" onClick={onBack}><BackIcon /></button>
        <h1>{name}</h1>
      </div>
      <div className="trend-scroll">
        <SegmentedControl label="範圍" items={TREND_RANGES} value={range} onPick={setRange} className="trend-range" />
        <section className="trend-card" aria-label="e1RM">
          <div className="an-hero">
            <div><span className="k">歷來最佳（估算）</span><span className="v">{best === null ? '—' : fmt1(best)}<small>kg</small></span></div>
            <div><span className="k">最近一次（估算）</span><span className="v">{latest ? fmt1(latest.e1rm) : '—'}<small>kg</small></span></div>
          </div>
          <div className="trend-head"><h2>e1RM <small>kg，估算</small></h2></div>
          {points.length === 0 ? (
            <p className="trend-empty">
              這段期間沒有紀錄
              <button type="button" className="trend-link" onClick={() => setRange('all')}>看全部</button>
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={points} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--rule-subtle)" />
                <XAxis {...axis} />
                <YAxis width={36} domain={yDomain} ticks={yTicks(yDomain)} tickLine={false} axisLine={false} />
                <Tooltip content={StrengthTip} cursor={{ stroke: 'var(--ink-faint)', strokeWidth: 1 }} isAnimationActive={false} />
                <Line dataKey="e1rm" name="e1RM 估算" type="monotone" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                  dot={dot} activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          {points.length === 1 && <p className="an-note">只有 1 次訓練，再練一次就畫得出線。</p>}
        </section>

        {points.length > 0 && (
          <section className="trend-card" aria-label="明細">
            <table className="trend-table">
              <caption className="sr-only">每次訓練的最重一組與估算 1RM，新到舊</caption>
              <thead><tr><th scope="col">日期</th><th scope="col">最重一組</th><th scope="col">e1RM</th></tr></thead>
              <tbody>
                {[...points].reverse().map((p) => (
                  <tr key={p.workoutId}>
                    <th scope="row">{p.date.slice(0, 4) === today.slice(0, 4) ? monthDay(p.date) : p.date.replace(/-/g, '/')}</th>
                    <td>{formatKg(p.topSet.weight_kg)} kg × {p.topSet.reps}</td>
                    <td>{fmt1(p.e1rm)} kg</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  )
}

export default function Analysis({ db, onBack }: AnalysisProps) {
  const [exerciseId, setExerciseId] = useState<string | null>(null)
  const list = useMemo(() => progressList(db), [db])
  const picked = exerciseId === null ? null : list.find((i) => i.exerciseId === exerciseId) ?? null

  // 選到的動作之後沒有有效組了（那次訓練被刪、或別的裝置改掉）：退回列表，並清掉選擇——
  // 否則它之後又有有效組時（復原、別台同步）會自己跳回單一動作頁
  useEffect(() => {
    if (exerciseId !== null && picked === null) setExerciseId(null)
  }, [exerciseId, picked])

  if (picked) {
    return <ExerciseProgress db={db} exerciseId={picked.exerciseId} name={picked.name} onBack={() => setExerciseId(null)} />
  }

  return (
    <div className="main" data-screen="analysis">
      <div className="lib-topbar">
        <button className="icon-btn" type="button" aria-label="返回訓練" onClick={onBack}><BackIcon /></button>
        <h1>訓練分析</h1>
      </div>
      <div className="trend-scroll">
        {list.length === 0 ? (
          <p className="trend-empty">還沒有可估算的紀錄。打勾完成的組（10 下以內、重量大於 0）才會列在這裡。</p>
        ) : (
          <>
            <div className="tr-card" data-section="progress-list">
              {list.map((i) => (
                <button key={i.exerciseId} className="tr-row" type="button" data-exercise-id={i.exerciseId} onClick={() => setExerciseId(i.exerciseId)}>
                  <span className="grow">
                    <span className="nm">{i.name}</span>
                    <span className="sub">{i.sessions} 次訓練 · 最近 {monthDay(i.lastDate)}</span>
                  </span>
                  <span className="an-val">{fmt1(i.best)} <small>kg 估算</small></span>
                  <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              ))}
            </div>
            <p className="an-note">只列有打勾完成的組；超過 10 下的組不估算（次數越多越不準）。</p>
          </>
        )}
      </div>
    </div>
  )
}
