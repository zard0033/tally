/* 吃、練、體重並排（spec「階段 4 丁」，v2.148，樣張 _design-sample/weekly-compare.html 的 A）：體重趨勢頁體重卡下面那張。
   三排小圖共用週的 X 軸（syncId）：平均體重、每週平均攝取＋目標虛線、訓練一次一格——三種量尺度不同，不做雙軸（dataviz）。
   讀數預設上週；手指在任一排拖曳（滑鼠移過、鍵盤方向鍵）選週，三排同一欄打底色、讀數換那週，放開回到上週（同 v2.146 體重卡）。
   選取底色用 ReferenceArea 畫在長條底下：tooltip 的自訂游標在 recharts 3 畫在所有圖形上面，會蓋住長條。
   運算在 src/lib/weeklyCompare.ts；只並排，不下因果結論。 */
import { useEffect, useMemo, useState } from 'react'
import { Bar, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type BarShapeProps } from 'recharts'
import ChartActiveDay from '@/components/ChartActiveDay'
import { useChartHover } from '@/components/useChartHover'
import { listIntakeKcal } from '@/lib/api'
import { dailyKcalFromRows, type DailyKcal } from '@/lib/baseline'
import { monthDay } from '@/lib/dates'
import type { TrainingDb } from '@/lib/training'
import { countedWorkoutDates, defaultWeekIndex, gapTexts, weeklyRows, WEEK_FULL_DAYS, type WeekRow } from '@/lib/weeklyCompare'
import { isoOfDay, signed1, spanDomain, yTicks } from '@/lib/weightTrend'

export interface WeeklyCompareProps {
  /** 範圍起點（含）；「全部」由呼叫端換成第一筆量測那天 */
  from: string
  today: string
  /** 全部歷史的趨勢點（由舊到新）：範圍第一週要拿範圍以前的趨勢算變化 */
  trend: readonly { date: string; trend: number }[]
  /** 現在的每日目標；算不出來是 null，不畫虛線 */
  targetKcal: number | null
  /** 訓練資料；null＝App 還沒載到 */
  training: TrainingDb | null
}

type Intake = { from: string; to: string; daily: DailyKcal[] } | { from: string; to: string; failed: true }

const SQ = 9 // 訓練一次一格的邊長
const SQ_GAP = 2
const AXIS_W = 36 // 三排的 Y 軸同寬，X 才對得齊（同體重卡）
const MARGIN = { top: 4, right: 8, bottom: 0, left: 0 }

const weekLabel = (w: WeekRow) => `${monthDay(w.from)}–${monthDay(w.to)}`

/** 攝取長條：記完整 ≥4 天實心、不到 4 天空心（只描邊），頂端圓角 3 */
function KcalBar({ x, y, width, height, payload }: BarShapeProps) {
  const w = payload as WeekRow
  if (!(height > 0)) return <g />
  const r = Math.min(3, width / 2, height)
  const d = `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height}`
  return w.fullDays >= WEEK_FULL_DAYS
    ? <path className="wk-bar" d={`${d} Z`} />
    : <path className="wk-bar is-thin" d={d} />
}

/** 一天都沒記完整的週：在底部寫「沒記」，不畫成 0 的長條。連續幾週沒記只在那一段的中間寫一次（一欄一個會連成一串）；
 *  那一段窄到放不下兩個字（「全部」範圍週很多時）改寫一槓 */
function GapMark({ x, y, width, height, payload }: BarShapeProps) {
  // recharts 3 對 null 值的那幾欄也會呼叫 shape（高度 0），要自己擋
  const { gap, gapText } = payload as { gap: number | null; gapText: string }
  if (gap === null || gapText === '') return <g />
  return <text className="wk-gap" x={x + width / 2} y={y + height - 4} textAnchor="middle">{gapText}</text>
}

/** 訓練：一次一格，從底往上疊 */
function WorkoutStack({ x, y, width, height, payload }: BarShapeProps) {
  const n = (payload as WeekRow).workouts
  const cx = x + width / 2
  const base = y + height
  return (
    <g>
      {Array.from({ length: n }, (_, k) => (
        <rect key={k} className="wk-sq" x={cx - SQ / 2} y={base - SQ - k * (SQ + SQ_GAP)} width={SQ} height={SQ} rx={2} />
      ))}
    </g>
  )
}

export default function WeeklyCompare({ from, today, trend, targetKcal, training }: WeeklyCompareProps) {
  const [intake, setIntake] = useState<Intake | null>(null)
  /* 切範圍就重撈；舊範圍的結果晚到不能蓋掉新的（alive）。新的回來之前沿用舊的那份、整張調淡（stale），
     不換成骨架——換成 300px 骨架的話，下面的明細表每切一次範圍就跳一次 */
  useEffect(() => {
    let alive = true
    listIntakeKcal(from, today).then(
      (rows) => alive && setIntake({ from, to: today, daily: dailyKcalFromRows(rows) }),
      () => alive && setIntake({ from, to: today, failed: true }),
    )
    return () => { alive = false }
  }, [from, today])
  const stale = intake !== null && (intake.from !== from || intake.to !== today)
  const daily = intake && 'daily' in intake ? intake.daily : null

  /* 訓練資料沒載到（App 還在讀，或本機與伺服器都讀不到）：攝取與體重照畫，訓練寫「還沒載到」，不讓整張卡卡在骨架 */
  const workoutDates = useMemo(() => (training ? countedWorkoutDates(training) : []), [training])
  const rows = useMemo(
    () => (daily ? weeklyRows({ from, today, daily, workoutDates, trend }) : null),
    [daily, workoutDates, from, today, trend],
  )
  /* 圖上「沒記」那格要一個非 null 的值才畫得出 shape；跟攝取同一疊（stackId），所以不會擠到旁邊 */
  const data = useMemo(() => {
    if (!rows) return []
    const texts = gapTexts(rows)
    return rows.map((w, i) => ({ ...w, gap: w.avgKcal === null ? 1 : null, gapText: texts[i] }))
  }, [rows])

  /* 三排（體重 0、攝取 1、訓練 2）共用一份「指到哪週」，規則見 useChartHover（v2.149） */
  const hover = useChartHover(3)

  if (intake === null || (stale && rows === null)) {
    return (
      <section className="trend-card wk-card" aria-label="吃、練、體重">
        <h2 className="wk-title">吃、練、體重：每週</h2>
        <div className="trend-skel wk-skel" aria-busy="true" aria-label="載入中" />
      </section>
    )
  }
  if (rows === null || rows.length === 0) {
    return (
      <section className="trend-card wk-card" aria-label="吃、練、體重">
        <h2 className="wk-title">吃、練、體重：每週</h2>
        <p className="trend-empty">{rows === null ? '連不上伺服器，載不到飲食紀錄。連上網路後再開一次。' : '這段期間沒有紀錄'}</p>
      </section>
    )
  }

  const def = defaultWeekIndex(rows)
  const hoverIdx = hover.t === null ? -1 : rows.findIndex((w) => w.t === hover.t)
  const sel = rows[hoverIdx >= 0 ? hoverIdx : def]
  const kgVals = rows.flatMap((w) => (w.trend === null ? [] : [w.trend]))
  const kgDomain = spanDomain(kgVals, 0.3, 1, 3)
  const kcalMax = Math.max(...rows.map((w) => w.avgKcal ?? 0), targetKcal ?? 0)
  const kcalDomain: [number, number] = [0, Math.max(500, Math.ceil((kcalMax * 1.1) / 500) * 500)]
  const maxWorkouts = Math.max(1, ...rows.map((w) => w.workouts))
  const trainH = maxWorkouts * (SQ + SQ_GAP) + 8
  const trained = training !== null
  const fullDays = rows.reduce((a, w) => a + w.fullDays, 0)
  const weighIns = trend.filter((p) => p.date >= from && p.date <= today).length
  const workouts = rows.reduce((a, w) => a + w.workouts, 0)
  const tickEvery = Math.max(1, Math.ceil(rows.length / 4))

  /* 只有攝取那張圖可以用鍵盤聚焦（方向鍵選週，另兩張跟著 syncId 走）：三張都可聚焦的話是三個沒有名字的 tab 停點 */
  const KEYBOARD_TITLE = '每週平均攝取；方向鍵切換週，上面的讀數跟著換'
  const tipActive = hover.tipActive
  const common = (i: number) => (
    <>
      <Tooltip active={tipActive} content={() => null} cursor={false} isAnimationActive={false} />
      <ChartActiveDay onDay={hover.onDay[i]} />
      <ReferenceArea x1={sel.t} x2={sel.t} fill="var(--raised)" fillOpacity={1} stroke="none" ifOverflow="visible" />
    </>
  )

  const readK = hoverIdx >= 0 ? `${weekLabel(sel)} 那週` : sel.current ? `這週（${weekLabel(sel)}，還沒過完）` : `上週（${weekLabel(sel)}）`
  const kcalSub = sel.avgKcal === null ? '沒有一天記滿午晚餐' : `每天平均（${sel.fullDays} 天有記午晚餐）`
  /* 中間幾週沒量時，變化是那幾週累積的：寫出週數，不冒充成這一週的變化 */
  const span = (w: WeekRow) => (w.deltaWeeks !== null && w.deltaWeeks > 1 ? `${w.deltaWeeks} 週來` : '')
  const kgSub = sel.trendDelta === null ? '這週沒量體重' : span(sel) ? `平均體重・${span(sel)}` : '平均體重變化'

  return (
    <section className={`trend-card wk-card${stale ? ' is-stale' : ''}`} aria-label="吃、練、體重" aria-busy={stale || undefined}>
      <h2 className="wk-title">吃、練、體重：每週</h2>
      {/* 讀數：不設 live region（拖曳時會一直播報）；同樣的數字在下面的週明細表 */}
      <div className="wk-read-k">{readK}</div>
      <dl className="wk-stats">
        <div><dt>{kcalSub}</dt><dd>{sel.avgKcal === null ? '—' : <>{sel.avgKcal}<small>卡</small></>}</dd></div>
        <div><dt>{trained ? '訓練' : '訓練資料還沒載到'}</dt><dd>{trained ? <>{sel.workouts}<small>次</small></> : '—'}</dd></div>
        <div><dt>{kgSub}</dt><dd>{sel.trendDelta === null ? '—' : <>{signed1(sel.trendDelta)}<small>kg</small></>}</dd></div>
      </dl>

      <h3 className="wk-band">平均體重 kg</h3>
      <div className="trend-chart-hit" {...hover.bind(0)}>
      <ResponsiveContainer width="100%" height={72}>
        <ComposedChart data={data} syncId="weekly-compare" margin={MARGIN} accessibilityLayer={false}>
          {common(0)}
          {/* scale="band" 要寫明：沒有 Bar 的圖，recharts 給類別軸 point 比例尺，頭尾兩點貼在圖框邊上、跟下面兩排的欄對不齊，
              選取底色（ReferenceArea 取 bandwidth）也變成 0 寬 */}
          <XAxis dataKey="t" scale="band" hide />
          <YAxis width={AXIS_W} domain={kgDomain} ticks={yTicks(kgDomain)} tickLine={false} axisLine={false} />
          <Line dataKey="trend" name="平均體重" connectNulls stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
            dot={{ r: 3, fill: 'var(--accent)', stroke: 'var(--card)', strokeWidth: 2 }} activeDot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      </div>

      {/* 目標的數字寫在標題，不標在圖上：長條常常剛好頂到目標線，標在線上會壓到長條 */}
      <h3 className="wk-band">平均攝取 卡／天{targetKcal !== null && <>・目標 <b>{Math.round(targetKcal)}</b></>}</h3>
      <div className="trend-chart-hit" {...hover.bind(1)}>
      <ResponsiveContainer width="100%" height={96}>
        <ComposedChart data={data} syncId="weekly-compare" margin={MARGIN} title={KEYBOARD_TITLE}>
          {common(1)}
          <XAxis dataKey="t" hide />
          <YAxis width={AXIS_W} domain={kcalDomain} ticks={[kcalDomain[1] / 2, kcalDomain[1]]} tickLine={false} axisLine={false} />
          <ReferenceLine y={0} stroke="var(--rule)" />
          <Bar dataKey="avgKcal" name="平均攝取" stackId="k" maxBarSize={14} shape={KcalBar} isAnimationActive={false} />
          <Bar dataKey="gap" stackId="k" maxBarSize={14} shape={GapMark} isAnimationActive={false} />
          {targetKcal !== null && (
            <ReferenceLine y={targetKcal} stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="4 3" ifOverflow="extendDomain" />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      </div>

      <h3 className="wk-band">訓練{!trained && '（訓練資料還沒載到）'}</h3>
      {/* 30＝recharts XAxis 預設高度：少算的話最上面那格會超出繪圖區、選取底色蓋不到 */}
      <div className="trend-chart-hit" {...hover.bind(2)}>
      <ResponsiveContainer width="100%" height={trainH + 30}>
        <ComposedChart data={data} syncId="weekly-compare" margin={MARGIN} accessibilityLayer={false}>
          {common(2)}
          <XAxis dataKey="t" tickFormatter={(t: number) => monthDay(isoOfDay(t))} interval={tickEvery - 1} tickLine={false} axisLine={{ stroke: 'var(--rule)' }} />
          <YAxis width={AXIS_W} domain={[0, maxWorkouts]} tick={false} axisLine={false} />
          <Bar dataKey="workouts" name="訓練次數" maxBarSize={14} shape={WorkoutStack} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      </div>

      <ul className="trend-legend wk-legend">
        <li><i className="k-line" aria-hidden="true" />平均體重</li>
        <li><i className="k-bar" aria-hidden="true" />平均攝取</li>
        <li><i className="k-hollow" aria-hidden="true" />這週午晚餐記不到 {WEEK_FULL_DAYS} 天</li>
        {targetKcal !== null && <li><i className="k-plan" aria-hidden="true" />現在的目標</li>}
        <li><i className="k-sq" aria-hidden="true" />訓練一次</li>
      </ul>
      <p className="trend-note wk-note">
        這段：有記午、晚餐 {fullDays} 天、量體重 {weighIns} 次{trained && `、訓練 ${workouts} 次`}。攝取只算午、晚餐都有記的天。
        {targetKcal !== null && '目標虛線是現在的設定，以前改過目標不回溯。'}只並排，不代表誰造成誰。
      </p>

      <details className="wk-details">
        <summary>每週明細</summary>
        <table className="wk-table">
          <caption className="sr-only">每週的平均攝取、訓練次數與平均體重變化，新到舊</caption>
          <thead><tr><th scope="col">週</th><th scope="col">平均攝取</th><th scope="col">訓練</th><th scope="col">體重</th></tr></thead>
          <tbody>
            {[...rows].reverse().map((w) => (
              <tr key={w.monday}>
                <th scope="row">{monthDay(w.from)}{w.current && <small>進行中</small>}</th>
                <td>{w.avgKcal === null ? '沒記' : <>{w.avgKcal} 卡<small>{w.fullDays} 天</small></>}</td>
                <td>{trained ? `${w.workouts} 次` : '—'}</td>
                <td>{w.trendDelta === null ? '—' : <>{signed1(w.trendDelta)} kg{span(w) && <small>{span(w)}</small>}</>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
