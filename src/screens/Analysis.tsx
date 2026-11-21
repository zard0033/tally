/* 訓練分析整頁（階段 4）：頂部分段「動作進度｜肌群狀態」。
   動作進度（A，樣張 `_design-sample/analysis.html`）：列出有已打勾組的動作，點進單一動作看 e1RM 折線、歷來最佳與逐次明細。
   v2.147（子頁換皮 B，樣張 `_design-sample/subpages.html`）：列表每列一條最近 30 天的小走勢＋這段變化；單一動作改用體重趨勢 v2.146 的寫法——
   頂端讀數（大數字＝最近一次 e1RM，拖曳換成那一次），不用浮動框。
   肌群狀態（C）：六個肌群最近一次練完到現在的恢復狀態，純顯示、不畫圖。
   運算在 src/lib/strength.ts、src/lib/recovery.ts；這裡只管畫。本頁是 lazy chunk（recharts 不進主 bundle）。
   整頁接管畫面（同動作庫、訓練中），進出時 Training 通知 App 收起底部列。 */
import { useEffect, useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChartActiveDay from '@/components/ChartActiveDay'
import { useChartHover } from '@/components/useChartHover'
import EmptyNote from '@/components/EmptyNote'
import SegmentedControl, { type SegItem } from '@/components/SegmentedControl'
import SubPageTop from '@/components/SubPageTop'
import TrendNoRecords from '@/components/TrendNoRecords'
import { localDate, monthDay, tableDate } from '@/lib/dates'
import { recoveryStatus, type MuscleRecovery } from '@/lib/recovery'
import { bestE1rm, chartPoints, progressList, strengthHistory, type ProgressListItem } from '@/lib/strength'
import { formatKg, MUSCLE_GROUP_LABEL, type TrainingDb } from '@/lib/training'
import { fmt1, niceDomain, PACE_MIN_SPAN_DAYS, signed1, sparklineOf, TREND_RANGES, xDomain, xTicks, yTicks, type TrendRange } from '@/lib/weightTrend'
import { trendXAxis } from '@/components/trendAxis'

interface AnalysisProps {
  db: TrainingDb
  onBack: () => void
}

function ExerciseProgress({ db, exerciseId, name, onBack }: { db: TrainingDb; exerciseId: string; name: string; onBack: () => void }) {
  const [range, setRange] = useState<TrendRange>('90')
  const today = useMemo(() => localDate(), [])
  const history = useMemo(() => strengthHistory(db, exerciseId), [db, exerciseId])
  const points = useMemo(() => chartPoints(history, range, today), [history, range, today])
  const dom = useMemo(() => xDomain(points, range, today), [points, range, today])
  const ticks = useMemo(() => (dom ? xTicks(dom[0], dom[1]) : []), [dom])
  const yDomain = useMemo(() => niceDomain(points.map((p) => p.e1rm), 2, 5), [points])
  const first = points[0]
  const last = points[points.length - 1]
  const best = bestE1rm(history)
  const latest = history[history.length - 1]
  /* 指到的那一次（日序）；手指放開、重新起手、點一下的規則見 useChartHover（v2.149，同體重趨勢） */
  const hover = useChartHover(1)
  const hp = hover.t === null ? null : points.find((p) => p.t === hover.t) ?? null
  const label = TREND_RANGES.find((r) => r.key === range)?.label ?? ''

  const axis = trendXAxis(dom, ticks)

  /* 每次訓練一個點（點少）：空心圈，最後一點實心；數字在讀數區，不再標在圖上 */
  const dot = (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props
    if (cx === undefined || cy === undefined) return <g key={index} />
    return index === points.length - 1
      ? <circle key={index} cx={cx} cy={cy} r={4.5} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
      : <circle key={index} cx={cx} cy={cy} r={3} fill="var(--card)" stroke="var(--accent)" strokeWidth={1.5} />
  }

  /* 讀數下一行（沒指著時）：歷來最佳＋這段變化（頭尾不到 7 天不寫，同體重趨勢） */
  const summary = () => {
    const parts = [`歷來最佳 ${best === null ? '—' : fmt1(best)}`]
    if (first && last && last.t - first.t >= PACE_MIN_SPAN_DAYS) parts.push(`${label} ${signed1(last.e1rm - first.e1rm)} kg`)
    return parts.join('・')
  }

  return (
    <div className="main" data-screen="analysis-exercise">
      <SubPageTop title={name} backLabel="返回訓練分析" onBack={onBack} />
      <div className="trend-scroll">
        <SegmentedControl label="範圍" items={TREND_RANGES} value={range} onPick={setRange} className="trend-range" />
        <section className="trend-card" aria-label="e1RM">
          {/* 讀數：大數字不隨範圍變（最近一次是整段歷史的最後一次）；指著時換成那一次 */}
          <div className="trend-read">
            <div className="trend-read-k">{hp ? `${monthDay(hp.date)} 這次（估算）` : '最近一次 e1RM（估算）'}</div>
            <div className="trend-read-big"><b>{hp ? fmt1(hp.e1rm) : latest ? fmt1(latest.e1rm) : '—'}</b><span>kg</span></div>
            <p className="trend-read-sub">
              {hp ? <>最重一組 <b>{formatKg(hp.topSet.weight_kg)} × {hp.topSet.reps}</b></> : summary()}
            </p>
          </div>
          {points.length === 0 ? (
            <TrendNoRecords onSeeAll={() => setRange('all')} />
          ) : (
            <div className="trend-chart-hit" {...hover.bind(0)}>
            <ResponsiveContainer width="100%" height={190}>
              <ComposedChart data={points} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="an-area-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="var(--accent)" stopOpacity={0.14} />
                    <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--rule-subtle)" />
                <XAxis {...axis} />
                <YAxis width={36} domain={yDomain} ticks={yTicks(yDomain)} tickLine={false} axisLine={false} />
                <Tooltip active={hover.tipActive} content={() => null} cursor={{ stroke: 'var(--ink-faint)', strokeWidth: 1 }} isAnimationActive={false} />
                <ChartActiveDay onDay={hover.onDay[0]} />
                <Area dataKey="e1rm" type="linear" stroke="none" fill="url(#an-area-fill)" activeDot={false} isAnimationActive={false} />
                <Line dataKey="e1rm" name="e1RM 估算" type="linear" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                  dot={dot} activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            </div>
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
                    <th scope="row">{tableDate(p.date, today)}</th>
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

/** 列表一列（v2.147）：最近 30 天的 e1RM 小走勢＋這段變化；30 天內不到兩次就不畫、不寫變化 */
function ProgressRow({ db, item, today, onOpen }: { db: TrainingDb; item: ProgressListItem; today: string; onOpen: () => void }) {
  const recent = useMemo(() => chartPoints(strengthHistory(db, item.exerciseId), '30', today), [db, item.exerciseId, today])
  // 頭尾不到 7 天不寫變化（同單一動作頁與體重趨勢）；小走勢照畫
  const delta = recent.length >= 2 && recent[recent.length - 1].t - recent[0].t >= PACE_MIN_SPAN_DAYS ? recent[recent.length - 1].e1rm - recent[0].e1rm : null
  return (
    <button className="tr-row" type="button" data-exercise-id={item.exerciseId} onClick={onOpen}>
      <span className="grow">
        <span className="nm">{item.name}</span>
        <span className="sub">{item.sessions} 次訓練 · 最近 {monthDay(item.lastDate)}</span>
      </span>
      {recent.length >= 2 && (
        <svg className="an-spark" viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={sparklineOf(recent.map((p) => p.e1rm))} />
        </svg>
      )}
      <span className="an-val">
        {fmt1(item.best)} <small>kg 估算</small>
        {delta !== null && <span className="an-delta">30 天 {signed1(delta)}</span>}
      </span>
      <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}

type AnalysisTab = 'progress' | 'recovery'
const TABS: SegItem<AnalysisTab>[] = [
  { key: 'progress', label: '動作進度' },
  { key: 'recovery', label: '肌群狀態' },
]

const daysAgoText = (n: number) => (n === 0 ? '今天' : n === 1 ? '昨天' : `${n} 天前`)

function RecoveryRow({ r }: { r: MuscleRecovery }) {
  const label = MUSCLE_GROUP_LABEL[r.group]
  return (
    <div className="tr-row" data-group={r.group} data-state={r.state}>
      <span className="grow">
        <span className="nm">{label}</span>
        {r.state !== 'none' && <span className="sub">{daysAgoText(r.daysAgo!)} · {r.sets} 組{r.nearFailure ? ' · 近力竭' : ''}</span>}
      </span>
      {r.state === 'recovering' && <span className="an-state">恢復中<small>還需約 {r.remainingHours} 小時</small></span>}
      {r.state === 'ready' && <span className="an-state is-ready">可再練</span>}
      {r.state === 'none' && <span className="an-state is-none">沒有紀錄</span>}
    </div>
  )
}

function RecoveryList({ db }: { db: TrainingDb }) {
  // 開頁取一次「現在」，回到前景再取一次（PWA 退背景再喚回常不重新載入）；停在前景不動時不會自己更新
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(new Date())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  const rows = useMemo(() => recoveryStatus(db, now), [db, now])
  return (
    <>
      <div className="tr-card" data-section="recovery-list">
        {rows.map((r) => <RecoveryRow key={r.group} r={r} />)}
      </div>
      <p className="an-note">
        依部位與訓練量粗估（下半身 48–72 小時，其餘 24–48 小時）；有一組做到 RPE 9 以上，再加 24 小時。重量不到當天最重一組 60% 的熱身組不計入組數。
      </p>
    </>
  )
}

export default function Analysis({ db, onBack }: AnalysisProps) {
  const [tab, setTab] = useState<AnalysisTab>('progress')
  const today = useMemo(() => localDate(), [])
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
      <SubPageTop title="訓練分析" backLabel="返回訓練" onBack={onBack} />
      <div className="trend-scroll">
        <SegmentedControl label="分析項目" items={TABS} value={tab} onPick={setTab} className="trend-range" />
        {tab === 'recovery' ? (
          <RecoveryList db={db} />
        ) : list.length === 0 ? (
          <EmptyNote art="bars">還沒有可估算的紀錄。打勾完成的組（10 下以內、重量大於 0）才會列在這裡。</EmptyNote>
        ) : (
          <>
            <div className="tr-card" data-section="progress-list">
              {list.map((i) => (
                <ProgressRow key={i.exerciseId} db={db} item={i} today={today} onOpen={() => setExerciseId(i.exerciseId)} />
              ))}
            </div>
            <p className="an-note">只列有打勾完成的組；超過 10 下的組不估算（次數越多越不準）。小走勢是最近 30 天的 e1RM。</p>
          </>
        )}
      </div>
    </div>
  )
}
