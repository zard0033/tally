/* 體重趨勢獨立頁（spec.md「體重趨勢圖」；v2.146 改版＝樣張 _design-sample/weight-chart.html 的 A「先講結論」）。
   趨勢線用直線段：一週量一次時兩點之間沒有資料，平滑曲線會畫出不存在的弧。
   一張卡：頂端讀數（大數字＝現在的趨勢體重，下一行＝這段變化與比計畫多少）→ 體重圖 → 體脂小圖，兩張圖共用 X 軸與十字線（syncId）。
   手指在圖上拖曳時，讀數換成指到的那一天（當次量測、趨勢、體脂），放開回到最新——浮動框會蓋住圖，所以不用。
   讀數跟著 recharts 自己的 tooltip 狀態走（滑鼠、手指、鍵盤方向鍵是同一份），不另外聽指標事件，十字線跟讀數才不會各指一天。
   量法斷點只切體脂（v2.146）：體重照常連續；體脂在斷點斷開，斷點前的那段畫淡。
   運算在 src/lib/weightTrend.ts；這裡只管畫。本頁是 lazy chunk（recharts 不進主 bundle）。 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, useActiveTooltipDataPoints, useIsTooltipActive } from 'recharts'
import EmptyNote from '@/components/EmptyNote'
import SegmentedControl from '@/components/SegmentedControl'
import SubPageTop from '@/components/SubPageTop'
import TrendNoRecords from '@/components/TrendNoRecords'
import { listWeights, setWeightBreak, type Weight } from '@/lib/api'
import { errMsg, friendlyError } from '@/lib/errors'
import { dayIndex, localDate, monthDay, tableDate } from '@/lib/dates'
import { fmt1, PACE_MIN_SPAN_DAYS, planAt, signed1, spanDomain, TREND_RANGES, trendPoints, withPlan, xDomain, xTicks, yTicks, type TrendPoint, type TrendRange } from '@/lib/weightTrend'
import { trendXAxis } from '@/components/trendAxis'

/** 「全部」要撈完整歷史：listWeights 預設只給 90 筆。1000 是 Supabase 單次回應上限。 */
const FULL_HISTORY = 1000

/** 換量法之後體脂量到這麼多筆以前，提示寫出筆數（假設值：指數平滑大約要 3–4 筆才走穩） */
const FAT_SETTLE_READINGS = 4

export interface WeightTrendProps {
  weights: Weight[] | null
  /** 現在設定的每週速度（kg，減重為負）；自訂目標是 null，不畫計畫線（v2.137） */
  plannedKgPerWeek: number | null
  /** 明細表改了量法斷點：設定頁重撈體重（v2.138；v2.146 起斷點只切體脂，不再叫 App 重算回推） */
  onBreakChange: () => void
  onBack: () => void
}

type PlanPoint = TrendPoint & { plan: number | null }
type LabelBox = { viewBox: { x: number; y: number } }

/** 掛在圖裡面，把 recharts 自己的 tooltip 狀態（指到哪一天）往上回報；記日序不記索引——切範圍、完整歷史晚到時索引會指到別天 */
function ActiveDay({ onDay }: { onDay: (t: number | null) => void }) {
  const active = useIsTooltipActive()
  const pts = useActiveTooltipDataPoints<PlanPoint>()
  const t = active && pts && pts.length > 0 ? pts[0].t : null
  useEffect(() => { onDay(t) }, [t, onDay])
  return null
}

/** 圖上的小字（計畫、換量法）：卡片色光暈，壓在線上也讀得到（同 v2.75 端點數字的做法） */
const chartNote = (x: number, y: number, text: string, anchor: 'start' | 'end') => (
  <text className="trend-chart-note" x={x} y={y} textAnchor={anchor}>{text}</text>
)

export default function WeightTrend({ weights, plannedKgPerWeek, onBreakChange, onBack }: WeightTrendProps) {
  const [range, setRange] = useState<TrendRange>('90')
  const [full, setFull] = useState<Weight[] | null>(null)
  const [failed, setFailed] = useState(false)
  /* 指在圖上的那一天（日序），兩張圖各一份（syncId 會讓兩張一起動，但這裡不賭另一張的狀態有沒有同步過來）；
     released＝手指剛放開：recharts 放開後不收 tooltip，這裡把兩張的 tooltip 關掉、讀數回到最新 */
  const [hoverW, setHoverW] = useState<number | null>(null)
  const [hoverF, setHoverF] = useState<number | null>(null)
  const [released, setReleased] = useState(false)
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
  const ticks = useMemo(() => (dom ? xTicks(dom[0], dom[1]) : []), [dom])
  /* 軸只照量到的值定、至少跨 4 kg（v2.146：1 kg 的日常起伏不放大成大浪）；計畫線超出就在圖框切掉（allowDataOverflow，v2.137 review） */
  const kgDomain = useMemo(() => spanDomain(points.flatMap((p) => [p.kg, p.trend]), 0.3, 1, 4), [points])
  const fatPoints = useMemo(() => points.filter((p) => p.fat !== null), [points])
  const fatDomain = useMemo(() => spanDomain(fatPoints.flatMap((p) => [p.fat as number, p.fatTrend as number]), 0.5, 2, 4), [fatPoints])
  const first = points[0]
  const last = points[points.length - 1]
  const hoverT = released ? null : hoverW ?? hoverF
  const hp: PlanPoint | null = hoverT === null ? null : points.find((p) => p.t === hoverT) ?? null
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
  const engage = () => setReleased(false)
  const pointer = { onMouseMove: engage, onTouchStart: engage, onTouchEnd: () => setReleased(true) }
  /* 手指放開後兩張圖的 tooltip（十字線、亮點）一起收掉；其餘時候交給 recharts 自己判斷 */
  const tipActive = released ? false : undefined

  /* 讀數下一行（沒指著時）：這段變化＋比計畫多少。頭尾不到 7 天不寫變化（一週以內幾乎全是水分） */
  const summary = () => {
    const label = TREND_RANGES.find((r) => r.key === range)?.label ?? ''
    const parts = [last.t - first.t < PACE_MIN_SPAN_DAYS ? '這段量測太少，算不出變化' : `${label} ${signed1(last.trend - first.trend)} kg`]
    const planLast = plannedKgPerWeek === null ? null : planAt(points, plannedKgPerWeek, last.t)
    if (planLast !== null) {
      // 跟最後一筆那天的計畫比（不是今天的）：好幾天沒量的話，拿今天的計畫比會每天自己變大
      const gap = last.trend - planLast
      parts.push(Math.abs(gap) < 0.05 ? '跟計畫一樣' : `比計畫${gap > 0 ? '多' : '少'} ${fmt1(Math.abs(gap))} kg`)
    }
    return parts.join('・')
  }

  /* 計畫小標（v2.146）：只在計畫今天的位置跑出圖框時標，標在計畫線穿出圖框的地方，箭頭指出界的方向——
     線看不到終點時才需要字；還在圖內時圖例認得出虛線、讀數那行已寫「比計畫多 x」，再標一次會壓到線或 X 軸字 */
  const planMark = () => {
    if (plannedKgPerWeek === null || planNow === null || !first || !dom) return null
    const [lo, hi] = kgDomain
    if (planNow >= lo && planNow <= hi) return null
    const text = `計畫：今天該在 ${fmt1(planNow)}`
    const down = planNow < lo
    const edge = down ? lo : hi
    const exitT = first.t + ((edge - first.trend) / plannedKgPerWeek) * 7
    if (!Number.isFinite(exitT) || exitT < dom[0] || exitT > dom[1]) return null
    // 穿出點在右半邊時字往左寫，不然會超出圖的右緣被切掉
    const right = (exitT - dom[0]) / (dom[1] - dom[0] || 1) > 0.5
    return <ReferenceDot x={exitT} y={edge} r={0} fill="none" stroke="none" ifOverflow="visible"
      label={({ viewBox }: LabelBox) => chartNote(viewBox.x + (right ? -6 : 6), viewBox.y + (down ? -6 : 14), `${text} ${down ? '↓' : '↑'}`, right ? 'end' : 'start')} />
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
    body = <TrendNoRecords onSeeAll={() => setRange('all')} />
  } else {
    body = (
      <>
        <div className="trend-card">
          <section aria-label="體重">
            {/* 讀數：沒指著＝現在的趨勢與結論；指著＝那一天。同樣的數字明細表也讀得到，不設 live region（拖曳時會一直播報） */}
            <div className="trend-read">
              <div className="trend-read-k">{hp ? `${monthDay(hp.date)} 量到` : '現在的趨勢體重'}</div>
              <div className="trend-read-big"><b>{fmt1(hp ? hp.kg : last.trend)}</b><span>kg</span></div>
              <p className="trend-read-sub">
                {hp ? (
                  <>趨勢 <b>{fmt1(hp.trend)}</b>{hp.fat !== null && <>・體脂 <b>{fmt1(hp.fat)}</b>%</>}{hp.brk && hp.seg > 0 && '・換量法'}</>
                ) : summary()}
              </p>
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <ComposedChart data={points} syncId="weight-trend" margin={{ top: 12, right: 8, bottom: 0, left: 0 }} {...pointer}>
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
                <ActiveDay onDay={setHoverW} />
                {plannedKgPerWeek !== null && (
                  <Line dataKey="plan" name="計畫" stroke="var(--ink-muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />
                )}
                <Area dataKey="trend" type="linear" stroke="none" fill="url(#trend-area-fill)" activeDot={false} isAnimationActive={false} />
                <Line dataKey="trend" name="趨勢" type="linear" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                  dot={endDot} activeDot={false} isAnimationActive={false} />
                <Line dataKey="kg" name="每次量測" stroke="none" dot={{ r: 3, fill: 'var(--card)', stroke: 'var(--ink-faint)', strokeWidth: 1.5 }}
                  activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
                {planMark()}
              </ComposedChart>
            </ResponsiveContainer>
            <ul className="trend-legend">
              <li><i className="k-ring" aria-hidden="true" />每次量測</li>
              <li><i className="k-line" aria-hidden="true" />趨勢</li>
              {plannedKgPerWeek !== null && <li><i className="k-plan" aria-hidden="true" />計畫</li>}
            </ul>
          </section>

          <section aria-label="體脂" className="trend-fat">
            <div className="trend-subhead">
              <h3>體脂</h3>
              {lastFat && (
                <span className="trend-subval">
                  {hp
                    ? (hp.fat === null ? '—' : <>{fmt1(hp.fat)}<small>%</small></>)
                    : curFat ? <>{fmt1(curFat.fatTrend as number)}<small>% 趨勢</small></> : '—'}
                </span>
              )}
            </div>
            {!lastFat ? (
              <p className="trend-empty">這段期間沒有體脂紀錄</p>
            ) : (
              <>
                {lastBreak && (
                  <p className="trend-note">
                    {monthDay(lastBreak.date)} 換量法，前後不能直接比{afterBreak < FAT_SETTLE_READINGS && `；換了之後量了 ${afterBreak} 筆`}
                  </p>
                )}
                <ResponsiveContainer width="100%" height={96}>
                  <ComposedChart data={points} syncId="weight-trend" margin={{ top: 8, right: 8, bottom: 0, left: 0 }} {...pointer}>
                    <CartesianGrid vertical={false} stroke="var(--rule-subtle)" />
                    <XAxis {...axis} />
                    {/* 96px 高的小圖放不下每 1% 一條刻度，至少每 2% */}
                    <YAxis width={36} domain={fatDomain} ticks={yTicks(fatDomain, 2)} tickLine={false} axisLine={false} />
                    <Tooltip active={tipActive} content={() => null} cursor={{ stroke: 'var(--ink-faint)', strokeWidth: 1 }} isAnimationActive={false} />
                    <ActiveDay onDay={setHoverF} />
                    {breaks.map((p) => (
                      <ReferenceLine key={p.date} x={p.t} stroke="var(--ink-faint)" strokeDasharray="2 3"
                        label={({ viewBox }: LabelBox) => chartNote(viewBox.x - 4, viewBox.y + 10, '換量法', 'end')} />
                    ))}
                    {/* 每一段各畫一條、在斷點斷開；之前的段畫淡（v2.146）。段內沒填體脂的日子跳過（connectNulls 只連同一段） */}
                    {fatSegs.map((sg) => (
                      <Line key={`fat-${sg}`} dataKey={(p: PlanPoint) => (p.seg === sg ? p.fatTrend : null)} name="體脂趨勢" connectNulls
                        stroke="var(--ink-muted)" strokeOpacity={sg === lastSeg ? 1 : 0.45} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                        dot={false} activeDot={false} isAnimationActive={false} />
                    ))}
                    <Line dataKey="fat" name="體脂" stroke="none" dot={fatDot}
                      activeDot={{ r: 4.5, fill: 'var(--ink-muted)', stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </>
            )}
          </section>
        </div>

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
                        {p.brk && p.seg > 0 && <span className="trend-brk-tag">換量法</span>}
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
                          體脂從這天起量法不同（換了秤或電池）
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
