/* 體重趨勢獨立頁（spec.md「體重趨勢圖」）。兩張圖：體重（每次量測的點＋7 日平均線）、體脂，
   共用 X 軸與十字線（recharts 的 syncId，兩張吃同一份 points 所以索引對得上）。
   浮動 tooltip 只掛在體重圖上、列出三個值；體脂圖的 tooltip 內容是空的，指標在體脂圖上移動時
   同步出現在體重圖的那一個——「一個 tooltip 列全部系列」，不會兩個框疊在一起。
   運算在 src/lib/weightTrend.ts；這裡只管畫。本頁是 lazy chunk（recharts 不進主 bundle）。 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import EmptyNote from '@/components/EmptyNote'
import SegmentedControl from '@/components/SegmentedControl'
import SubPageTop from '@/components/SubPageTop'
import TrendNoRecords from '@/components/TrendNoRecords'
import { listWeights, setWeightBreak, type Weight } from '@/lib/api'
import { errMsg, friendlyError } from '@/lib/errors'
import { rateWeeklyToMonthly } from '@/lib/formulas'
import { localDate, monthDay, tableDate } from '@/lib/dates'
import { actualKgPerWeek, fmt1, niceDomain, signedKg, TREND_RANGES, trendPoints, withPlan, xDomain, xTicks, yTicks, type TrendPoint, type TrendRange } from '@/lib/weightTrend'
import { trendXAxis } from '@/components/trendAxis'

/** 「全部」要撈完整歷史：listWeights 預設只給 90 筆。1000 是 Supabase 單次回應上限。 */
const FULL_HISTORY = 1000

export interface WeightTrendProps {
  weights: Weight[] | null
  /** 現在設定的每週速度（kg，減重為負）；自訂目標是 null，不畫計畫線（v2.137） */
  plannedKgPerWeek: number | null
  /** 明細表改了量法斷點：設定頁重撈體重、回推重算（v2.138） */
  onBreakChange: () => void
  onBack: () => void
}

type PlanPoint = TrendPoint & { plan: number | null }

/** 浮動讀數：值在前（粗）、名稱在後（淡）；體脂沒填寫「—」。 */
function TrendTip({ active, payload }: TooltipContentProps) {
  const p = payload?.[0]?.payload as PlanPoint | undefined
  if (!active || !p) return null
  return (
    <div className="trend-tip" role="status">
      <div className="trend-tip-date">{monthDay(p.date)}</div>
      <div className="trend-tip-row"><b>{fmt1(p.kg)} kg</b><span>當次量測</span></div>
      <div className="trend-tip-row"><b>{fmt1(p.avg)} kg</b><span>7 日平均</span></div>
      <div className="trend-tip-row"><b>{p.fat === null ? '—' : `${fmt1(p.fat)} %`}</b><span>體脂</span></div>
      {p.plan !== null && <div className="trend-tip-row"><b>{fmt1(p.plan)} kg</b><span>照計畫</span></div>}
    </div>
  )
}

export default function WeightTrend({ weights, plannedKgPerWeek, onBreakChange, onBack }: WeightTrendProps) {
  const [range, setRange] = useState<TrendRange>('90')
  const [full, setFull] = useState<Weight[] | null>(null)
  const [failed, setFailed] = useState(false)
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
  /* 計畫線（v2.137，spec「減重回饋圈 review」④，使用者 2026-11-14 選只放趨勢頁）：從這段第一點的 7 日平均起照現在的速度走 */
  const points = useMemo(
    () => withPlan(source ? trendPoints(source, range, today) : [], plannedKgPerWeek),
    [source, range, today, plannedKgPerWeek],
  )
  const actual = useMemo(() => actualKgPerWeek(points), [points])
  const dom = useMemo(() => xDomain(points, range, today), [points, range, today])
  const ticks = useMemo(() => (dom ? xTicks(dom[0], dom[1]) : []), [dom])
  /* 軸只照量到的值定，計畫線超出就在圖框切掉（allowDataOverflow）：範圍長時計畫線會掉十幾公斤，照它撐軸會把真正的資料壓成一條細帶（v2.137 review） */
  const kgDomain = useMemo(() => niceDomain(points.flatMap((p) => [p.kg, p.avg]), 0.3, 1), [points])
  const fatPoints = points.filter((p) => p.fat !== null)
  const fatDomain = useMemo(() => niceDomain(fatPoints.map((p) => p.fat as number), 0.5, 1), [fatPoints])
  const last = points[points.length - 1]
  const breaks = points.filter((p) => p.brk && p.seg > 0)
  /* 每一段各畫一條線，斷點那裡斷開：連過去的話，換電池造成的跳動會畫成一段真的在漲的斜坡（v2.138） */
  const segIds = [...new Set(points.map((p) => p.seg))]
  const lastSeg = segIds[segIds.length - 1]
  /* 斷點那天一條垂直細線＋小標（v2.138）：讀數在這天整段平移，7 日平均從這天重新起算 */
  const breakLines = (label: boolean) =>
    breaks.map((p) => (
      <ReferenceLine key={p.date} x={p.t} stroke="var(--ink-faint)" strokeWidth={1}
        label={label ? { value: '換量法', position: 'insideTopLeft', fill: 'var(--ink-muted)', fontSize: 11 } : undefined} />
    ))

  const axis = trendXAxis(dom, ticks)

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
        <section className="trend-card" aria-label="體重">
          <div className="trend-head">
            <h2>體重 <small>kg</small></h2>
            <ul className="trend-legend">
              <li><i className="k-dot" aria-hidden="true" />每次量測</li>
              <li><i className="k-line" aria-hidden="true" />7 日平均</li>
              {plannedKgPerWeek !== null && <li><i className="k-plan" aria-hidden="true" />計畫</li>}
            </ul>
          </div>
          {/* 計畫 vs 實際：一句話說落差，數字在圖上也看得到（線），這行是給不看圖的讀法 */}
          <p className="trend-pace">
            {/* 用每月：每日目標頁選速度是 kg/月，寫每週的話是一個使用者沒選過的數字（v2.137 review） */}
            {plannedKgPerWeek !== null && `計畫每月 ${signedKg(rateWeeklyToMonthly(plannedKgPerWeek))} kg・`}
            {actual === null ? '這段量測太少，算不出走勢' : `這段實際每月 ${signedKg(rateWeeklyToMonthly(actual))} kg`}
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={points} syncId="weight-trend" margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--rule-subtle)" />
              <XAxis {...axis} />
              <YAxis width={36} domain={kgDomain} ticks={yTicks(kgDomain)} tickLine={false} axisLine={false} allowDataOverflow />
              <Tooltip content={TrendTip} cursor={{ stroke: 'var(--ink-faint)', strokeWidth: 1 }} isAnimationActive={false} />
              {breakLines(true)}
              {plannedKgPerWeek !== null && (
                <Line dataKey="plan" name="計畫" stroke="var(--ink-muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />
              )}
              <Line dataKey="kg" name="當次量測" stroke="none" dot={{ r: 3, fill: 'var(--ink-faint)', stroke: 'none' }} activeDot={false} isAnimationActive={false} />
              {segIds.map((s) => (
                <Line key={`avg-${s}`} dataKey={(p: PlanPoint) => (p.seg === s ? p.avg : null)} name="7 日平均" type="monotone" stroke="var(--accent)" strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round" dot={s === lastSeg ? endDot : false}
                  activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
              ))}
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
                {breakLines(false)}
                {segIds.map((s) => (
                  <Line key={`fat-${s}`} dataKey={(p: PlanPoint) => (p.seg === s ? p.fat : null)} name="體脂" connectNulls stroke="var(--ink-muted)" strokeWidth={2}
                    strokeLinecap="round" strokeLinejoin="round"
                    dot={{ r: 4, fill: 'var(--ink-muted)', stroke: 'var(--card)', strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: 'var(--ink-muted)', stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
                ))}
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
                          從這天起量法不同（換了秤或電池）
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
