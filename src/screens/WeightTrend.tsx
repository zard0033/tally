/* 體重趨勢獨立頁（spec.md「體重趨勢圖」；v2.146 改版＝樣張 _design-sample/weight-chart.html 的 A「先講結論」）。
   趨勢線用直線段：一週量一次時兩點之間沒有資料，平滑曲線會畫出不存在的弧。
   一張卡：標題「體重」→ 讀數（v2.149：大數字固定＝平均體重；下一行最近一次／那天量到的；再下一行這段變化與比目標進度多少）
   → 體重圖 → 體脂小圖，兩張圖共用 X 軸與十字線（syncId）。手指拖曳時讀數換成指到的那一天，拖完放開回到現在——浮動框會蓋住圖，所以不用。
   讀數跟著 recharts 自己的 tooltip 狀態走（滑鼠、手指、鍵盤方向鍵是同一份），觸控的收放、點一下、重新起手規則在 useChartHover。
   用詞（v2.149，使用者看不懂「趨勢體重」）：平滑值叫「平均體重」、計畫線叫「照目標」、量法斷點叫「換秤」。
   量法斷點只切體脂（v2.146）：體重照常連續；體脂在斷點斷開，斷點前的那段畫淡。
   運算在 src/lib/weightTrend.ts；這裡只管畫。本頁是 lazy chunk（recharts 不進主 bundle）。 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChartActiveDay from '@/components/ChartActiveDay'
import { useChartHover } from '@/components/useChartHover'
import EmptyNote from '@/components/EmptyNote'
import SegmentedControl from '@/components/SegmentedControl'
import SubPageTop from '@/components/SubPageTop'
import TrendNoRecords from '@/components/TrendNoRecords'
import { listWeights, setWeightBreak, type Weight } from '@/lib/api'
import type { TrainingDb } from '@/lib/training'
import { errMsg, friendlyError } from '@/lib/errors'
import { dayIndex, localDate, monthDay, tableDate } from '@/lib/dates'
import { fmt1, PACE_MIN_SPAN_DAYS, planAt, rangeStart, signed1, spanDomain, TREND_RANGES, trendPoints, withPlan, xDomain, xTicks, yTicks, type TrendPoint, type TrendRange } from '@/lib/weightTrend'
import { trendXAxis } from '@/components/trendAxis'
import WeeklyCompare from './WeeklyCompare'

/** 「全部」要撈完整歷史：listWeights 預設只給 90 筆。1000 是 Supabase 單次回應上限。 */
const FULL_HISTORY = 1000

/** 換量法之後體脂量到這麼多筆以前，提示寫出筆數（假設值：指數平滑大約要 3–4 筆才走穩） */
const FAT_SETTLE_READINGS = 4

export interface WeightTrendProps {
  weights: Weight[] | null
  /** 現在設定的每週速度（kg，減重為負）；自訂目標是 null，不畫計畫線（v2.137） */
  plannedKgPerWeek: number | null
  /** 現在的每日目標（吃、練、體重並排的目標虛線，v2.148）；算不出來是 null */
  targetKcal: number | null
  /** 訓練資料（並排卡的訓練次數，v2.148）；null＝App 還沒載到 */
  training: TrainingDb | null
  /** 明細表改了量法斷點：設定頁重撈體重（v2.138；v2.146 起斷點只切體脂，不再叫 App 重算回推） */
  onBreakChange: () => void
  onBack: () => void
}

type PlanPoint = TrendPoint & { plan: number | null }

/** 圖上的小字（目標進度、換秤）：卡片色光暈，壓在線上也讀得到（同 v2.75 端點數字的做法）。
 *  **要用模組層級的元件、以元素傳給 label**（recharts 會 clone，型別不變）：寫成 render 裡的箭頭函式，recharts 每次 render
 *  都當新元件型別重建 `<text>`——iOS 上手指起手落在被移除的節點，之後的 touchmove 送給脫離畫面的節點、冒泡不到 React，
 *  整張圖拖不動（v2.149，使用者回報體重圖拖不動、體脂圖可以；這是最可疑的差別，桌面重現不出） */
function ChartNote({ viewBox, text, anchor, dx, dy }: { viewBox?: { x: number; y: number }; text: string; anchor: 'start' | 'end'; dx: number; dy: number }) {
  if (!viewBox) return null
  return <text className="trend-chart-note" x={viewBox.x + dx} y={viewBox.y + dy} textAnchor={anchor}>{text}</text>
}

export default function WeightTrend({ weights, plannedKgPerWeek, targetKcal, training, onBreakChange, onBack }: WeightTrendProps) {
  const [range, setRange] = useState<TrendRange>('90')
  const [full, setFull] = useState<Weight[] | null>(null)
  const [failed, setFailed] = useState(false)
  /* 指在圖上的那一天：兩張圖（體重 0、體脂 1）共用一份，規則見 useChartHover（v2.149） */
  const hover = useChartHover(2)
  /* 明細表展開的那一列（v2.138：裡面是量法斷點的開關）；一次只開一列 */
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [brkBusy, setBrkBusy] = useState(false)
  const [brkErr, setBrkErr] = useState<string | null>(null)

  /* 改了就存（同每日目標頁的清單列）：先改畫面，失敗就改回來並說原因 */
  async function toggleBreak(date: string, on: boolean) {
    if (brkBusy) return
    const flip = (v: boolean) => (rows: Weight[] | null) => rows && rows.map((w) => (w.measured_on === date ? { ...w, method_break: v } : w))
    setBrkBusy(true)
    setBrkErr(null)
    setFull(flip(on))
    try {
      await setWeightBreak(date, on)
      onBreakChange()
    } catch (e) {
      setFull(flip(!on))
      setBrkErr(`沒有存到：${friendlyError(errMsg(e))}`)
    } finally {
      setBrkBusy(false)
    }
  }
  const today = useMemo(() => localDate(), [])

  /* 自己撈完整歷史；撈不到（離線、伺服器錯誤）就退回設定頁傳進來的那份，圖不空。
     設定頁撈失敗時傳進來的是 []（跟「真的 0 筆」長得一樣），所以這裡自己記 failed——
     「連不上」跟「還沒有體重紀錄」是兩句不同的話，不能把離線說成沒有紀錄。 */
  useEffect(() => {
    let alive = true
    listWeights(FULL_HISTORY).then((r) => alive && setFull(r)).catch(() => alive && setFailed(true))
    return () => { alive = false }
  }, [])

  const source = full ?? weights
  // 自己的請求還沒回來、手上又沒有資料可畫：不下結論，先骨架（否則真空帳號與離線都會先閃一下「還沒有體重紀錄」）
  const loading = full === null && !failed
  /* 計畫線（v2.137，spec「減重回饋圈 review」④，使用者 2026-11-14 選只放趨勢頁）：從這段第一點的趨勢起照現在的速度走 */
  const points = useMemo(
    () => withPlan(source ? trendPoints(source, range, today) : [], plannedKgPerWeek),
    [source, range, today, plannedKgPerWeek],
  )
  const dom = useMemo(() => xDomain(points, range, today), [points, range, today])
  /* 並排卡（v2.148）：趨勢要全部歷史（範圍第一週拿範圍以前的趨勢算變化）；「全部」從第一筆量測那天起，跟上面的圖同一個起點 */
  const allTrend = useMemo(() => (source ? trendPoints(source, 'all', today) : []), [source, today])
  const weekFrom = rangeStart(range, today) ?? allTrend[0]?.date ?? today
  const ticks = useMemo(() => (dom ? xTicks(dom[0], dom[1]) : []), [dom])
  /* 軸只照量到的值定、至少跨 4 kg（v2.146：1 kg 的日常起伏不放大成大浪）；計畫線超出就在圖框切掉（allowDataOverflow，v2.137 review） */
  const kgDomain = useMemo(() => spanDomain(points.flatMap((p) => [p.kg, p.trend]), 0.3, 1, 4), [points])
  const fatPoints = useMemo(() => points.filter((p) => p.fat !== null), [points])
  const fatDomain = useMemo(() => spanDomain(fatPoints.flatMap((p) => [p.fat as number, p.fatTrend as number]), 0.5, 2, 4), [fatPoints])
  const first = points[0]
  const last = points[points.length - 1]
  const hp: PlanPoint | null = hover.t === null ? null : points.find((p) => p.t === hover.t) ?? null
  const todayT = dayIndex(today)
  const planNow = plannedKgPerWeek === null ? null : planAt(points, plannedKgPerWeek, todayT)

  /* 體脂：段號由舊到新；最新一段畫實、之前的畫淡（換了量法，前後不能直接比） */
  const fatSegs = [...new Set(fatPoints.map((p) => p.seg))]
  const lastFat = fatPoints[fatPoints.length - 1]
  /* 現在的段看全部量測、不只看有填體脂的：斷點標在沒填體脂的那筆、之後還沒量過體脂時，舊量法的那段也要畫淡，數字寫「—」 */
  const lastSeg = last?.seg
  const curFat = lastFat && lastFat.seg === lastSeg ? lastFat : null
  const breaks = points.filter((p) => p.brk && p.seg > 0)
  const lastBreak = breaks[breaks.length - 1]
  const afterBreak = lastBreak ? fatPoints.filter((p) => p.seg === lastBreak.seg).length : 0

  const axis = trendXAxis(dom, ticks)
  /* 手指放開後兩張圖的 tooltip（十字線、亮點）一起收掉；其餘時候交給 recharts 自己判斷 */
  const tipActive = hover.tipActive

  /* 讀數第三行（沒指著時）：這段變化＋比目標進度多少。頭尾不到 7 天不寫變化（一週以內幾乎全是水分） */
  const summary = () => {
    const label = TREND_RANGES.find((r) => r.key === range)?.label ?? ''
    const parts = [last.t - first.t < PACE_MIN_SPAN_DAYS ? '量的次數太少，還看不出變化' : `${label}下來 ${signed1(last.trend - first.trend)} kg`]
    const planLast = plannedKgPerWeek === null ? null : planAt(points, plannedKgPerWeek, last.t)
    if (planLast !== null) {
      // 跟最後一筆那天的計畫比（不是今天的）：好幾天沒量的話，拿今天的計畫比會每天自己變大
      const gap = last.trend - planLast
      parts.push(Math.abs(gap) < 0.05 ? '跟目標進度一樣' : `比目標進度${gap > 0 ? '多' : '少'} ${fmt1(Math.abs(gap))} kg`)
    }
    return parts.join('・')
  }

  /* 計畫小標（v2.146）：只在計畫今天的位置跑出圖框時標，標在計畫線穿出圖框的地方，箭頭指出界的方向——
     線看不到終點時才需要字；還在圖內時圖例認得出虛線、讀數那行已寫「比計畫多 x」，再標一次會壓到線或 X 軸字 */
  const planMark = () => {
    if (plannedKgPerWeek === null || planNow === null || !first || !dom) return null
    const [lo, hi] = kgDomain
    if (planNow >= lo && planNow <= hi) return null
    const text = `照目標今天該在 ${fmt1(planNow)}`
    const down = planNow < lo
    const edge = down ? lo : hi
    const exitT = first.t + ((edge - first.trend) / plannedKgPerWeek) * 7
    if (!Number.isFinite(exitT) || exitT < dom[0] || exitT > dom[1]) return null
    // 穿出點在右半邊時字往左寫，不然會超出圖的右緣被切掉
    const right = (exitT - dom[0]) / (dom[1] - dom[0] || 1) > 0.5
    return <ReferenceDot x={exitT} y={edge} r={0} fill="none" stroke="none" ifOverflow="visible"
      label={<ChartNote text={`${text} ${down ? '↓' : '↑'}`} anchor={right ? 'end' : 'start'} dx={right ? -6 : 6} dy={down ? -6 : 14} />} />
  }

  /* 趨勢線只在最後一點畫端點；數字在讀數區，不再標在圖上 */
  const endDot = (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props
    if (index !== points.length - 1 || cx === undefined || cy === undefined) return <g key={index} />
    return <circle key={index} cx={cx} cy={cy} r={4.5} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
  }
  /* 體脂讀數點：之前的段畫淡 */
  const fatDot = (props: { cx?: number; cy?: number; index?: number; payload?: PlanPoint }) => {
    const { cx, cy, index, payload } = props
    if (cx === undefined || cy === undefined || !payload || payload.fat === null) return <g key={index} />
    return <circle key={index} cx={cx} cy={cy} r={2.5} fill="var(--card)" stroke="var(--ink-faint)" strokeWidth={1.5} opacity={payload.seg === lastSeg ? 1 : 0.45} />
  }

  let body
  if (source === null || (loading && source.length === 0)) {
    body = <div className="trend-skel" aria-busy="true" aria-label="載入中" />
  } else if (source.length === 0) {
    body = failed ? (
      <p className="trend-empty">連不上伺服器，載不到體重紀錄。連上網路後再開一次。</p>
    ) : (
      <EmptyNote art="scale">還沒有體重紀錄</EmptyNote>
    )
  } else if (points.length === 0) {
    // 範圍內沒量體重，飲食與訓練照樣可能有：並排卡照畫（v2.148 review）
    body = (
      <>
        <TrendNoRecords onSeeAll={() => setRange('all')} />
        <WeeklyCompare from={weekFrom} today={today} trend={allTrend} targetKcal={targetKcal} training={training} />
      </>
    )
  } else {
    body = (
      <>
        <div className="trend-card">
          <section aria-label="體重">
            <h2 className="trend-card-title">體重</h2>
            {/* 讀數（v2.149）：大數字的意思固定＝平均體重（沒指著＝現在、指著＝那一天）；下一行是單次量到的數字，再下一行是結論。
                v2.146 指著時大數字換成那天的單次量測，同一個大數字前後意思不同，使用者看不懂。
                同樣的數字明細表也讀得到，不設 live region（拖曳時會一直播報） */}
            <div className="trend-read">
              <div className="trend-read-k">{hp ? `${monthDay(hp.date)} 的平均體重` : '現在的平均體重'}</div>
              <div className="trend-read-big"><b>{fmt1(hp ? hp.trend : last.trend)}</b><span>kg</span></div>
              <p className="trend-read-sub">
                {hp ? (
                  <>那天量到 <b>{fmt1(hp.kg)}</b> kg{hp.fat !== null && <>・體脂 <b>{fmt1(hp.fat)}</b>%</>}</>
                ) : (
                  <>最近一次量到 <b>{fmt1(last.kg)}</b> kg（{monthDay(last.date)}）</>
                )}
              </p>
              <p className="trend-read-sub">{hp ? (hp.brk && hp.seg > 0 ? '這天起換了秤或電池' : '') : summary()}</p>
            </div>
            <div className="trend-chart-hit" {...hover.bind(0)}>
            <ResponsiveContainer width="100%" height={190}>
              <ComposedChart data={points} syncId="weight-trend" margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="trend-area-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="var(--accent)" stopOpacity={0.14} />
                    <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--rule-subtle)" />
                <XAxis {...axis} />
                <YAxis width={36} domain={kgDomain} ticks={yTicks(kgDomain)} tickLine={false} axisLine={false} allowDataOverflow />
                <Tooltip active={tipActive} content={() => null} cursor={{ stroke: 'var(--ink-faint)', strokeWidth: 1 }} isAnimationActive={false} />
                <ChartActiveDay onDay={hover.onDay[0]} />
                {plannedKgPerWeek !== null && (
                  <Line dataKey="plan" name="照目標的進度" stroke="var(--ink-muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />
                )}
                <Area dataKey="trend" type="linear" stroke="none" fill="url(#trend-area-fill)" activeDot={false} isAnimationActive={false} />
                {/* 指著時亮的是平均線上的點：大數字是平均，亮點跟著它（v2.149；之前亮單次量測的點） */}
                <Line dataKey="trend" name="平均體重" type="linear" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                  dot={endDot} activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
                <Line dataKey="kg" name="每次量到" stroke="none" dot={{ r: 3, fill: 'var(--card)', stroke: 'var(--ink-faint)', strokeWidth: 1.5 }}
                  activeDot={false} isAnimationActive={false} />
                {planMark()}
              </ComposedChart>
            </ResponsiveContainer>
            </div>
            <ul className="trend-legend">
              <li><i className="k-ring" aria-hidden="true" />每次量到</li>
              <li><i className="k-line" aria-hidden="true" />平均體重</li>
              {plannedKgPerWeek !== null && <li><i className="k-plan" aria-hidden="true" />照目標該走的路</li>}
            </ul>
            {/* 「平均體重」第一次出現的地方就說它是什麼（v2.149，使用者：「趨勢體重」是自創詞看不懂）。
                近 3 週：平滑常數 0.9，近 21 天佔約 89% 的權重、平均年齡約 9 天，跟 20 天簡單平均差不多；最近一週就佔約 52%，所以寫「越近的天算越重」 */}
            <p className="trend-note">平均體重：每天的體重會因為水分上下差 1 公斤，這條線把起伏平均掉，大約看近 3 週、越近的天算越重。</p>
          </section>

          <section aria-label="體脂" className="trend-fat">
            <div className="trend-subhead">
              <h3>體脂</h3>
              {lastFat && (
                <span className="trend-subval">
                  {hp
                    ? (hp.fat === null ? '—' : <>{fmt1(hp.fat)}<small>%</small></>)
                    : curFat ? <>{fmt1(curFat.fatTrend as number)}<small>% 平均</small></> : '—'}
                </span>
              )}
            </div>
            {!lastFat ? (
              <p className="trend-empty">這段期間沒有體脂紀錄</p>
            ) : (
              <>
                {lastBreak && (
                  <p className="trend-note">
                    {monthDay(lastBreak.date)} 換了秤或電池，前後不能直接比{afterBreak < FAT_SETTLE_READINGS && `；換了之後量了 ${afterBreak} 筆`}
                  </p>
                )}
                <div className="trend-chart-hit" {...hover.bind(1)}>
                <ResponsiveContainer width="100%" height={96}>
                  <ComposedChart data={points} syncId="weight-trend" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--rule-subtle)" />
                    <XAxis {...axis} />
                    {/* 96px 高的小圖放不下每 1% 一條刻度，至少每 2% */}
                    <YAxis width={36} domain={fatDomain} ticks={yTicks(fatDomain, 2)} tickLine={false} axisLine={false} />
                    <Tooltip active={tipActive} content={() => null} cursor={{ stroke: 'var(--ink-faint)', strokeWidth: 1 }} isAnimationActive={false} />
                    <ChartActiveDay onDay={hover.onDay[1]} />
                    {breaks.map((p) => (
                      <ReferenceLine key={p.date} x={p.t} stroke="var(--ink-faint)" strokeDasharray="2 3"
                        label={<ChartNote text="換秤" anchor="end" dx={-4} dy={10} />} />
                    ))}
                    {/* 每一段各畫一條、在斷點斷開；之前的段畫淡（v2.146）。段內沒填體脂的日子跳過（connectNulls 只連同一段） */}
                    {fatSegs.map((sg) => (
                      <Line key={`fat-${sg}`} dataKey={(p: PlanPoint) => (p.seg === sg ? p.fatTrend : null)} name="體脂平均" connectNulls
                        stroke="var(--ink-muted)" strokeOpacity={sg === lastSeg ? 1 : 0.45} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                        dot={false} activeDot={false} isAnimationActive={false} />
                    ))}
                    <Line dataKey="fat" name="體脂" stroke="none" dot={fatDot}
                      activeDot={{ r: 4.5, fill: 'var(--ink-muted)', stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                </div>
              </>
            )}
          </section>
        </div>

        <WeeklyCompare from={weekFrom} today={today} trend={allTrend} targetKcal={targetKcal} training={training} />

        <section className="trend-card" aria-label="明細">
          <table className="trend-table">
            <caption className="sr-only">體重與體脂明細，新到舊</caption>
            <thead><tr><th scope="col">日期</th><th scope="col">體重</th><th scope="col">體脂</th></tr></thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <Fragment key={p.date}>
                  <tr data-date={p.date}>
                    <th scope="row">
                      {/* 點日期展開這一列：量法斷點的開關（v2.138）。日期是按鈕，鍵盤與讀屏都進得去 */}
                      <button type="button" className="trend-row-btn" aria-expanded={openDate === p.date} aria-controls={`brk-${p.date}`}
                        onClick={() => { setBrkErr(null); setOpenDate(openDate === p.date ? null : p.date) }}>
                        {tableDate(p.date, today)}
                        {/* 斷點標在最早一筆上不切段、沒有作用，小標也不出現（開關照實反映存的值） */}
                        {p.brk && p.seg > 0 && <span className="trend-brk-tag">換秤</span>}
                      </button>
                    </th>
                    <td>{fmt1(p.kg)} kg</td>
                    <td>{p.fat === null ? '—' : `${fmt1(p.fat)} %`}</td>
                  </tr>
                  {openDate === p.date && (
                    <tr className="trend-row-more" id={`brk-${p.date}`}>
                      <td colSpan={3}>
                        <label className="check-row">
                          {/* 存檔中不用 disabled：鍵盤聚焦著時被停用，焦點會掉回頁首（v2.138 review）；改用 aria-disabled＋toggleBreak 開頭擋重送 */}
                          <input type="checkbox" checked={p.brk} disabled={full === null} aria-disabled={brkBusy || undefined}
                            onChange={(e) => void toggleBreak(p.date, e.target.checked)} />
                          從這天起換了秤或電池（體脂前後不能直接比）
                        </label>
                        {brkErr && <p className="trend-brk-err" role="alert">{brkErr}</p>}
                        {full === null && <p className="trend-brk-err">連不上伺服器，現在改不了。</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      </>
    )
  }

  return (
    <div className="main" data-screen="weight-trend">
      <SubPageTop title="體重趨勢" backLabel="返回設定" onBack={onBack} />
      <div className="trend-scroll">
        <SegmentedControl label="範圍" items={TREND_RANGES} value={range} onPick={setRange} className="trend-range" />
        {body}
      </div>
    </div>
  )
}
