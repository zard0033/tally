/* 今日頁「這週」卡（spec「熱量看這一週」，樣張 `_design-sample/weekly-v2.html` B）：
   卡頭左「這週」、右邊總帳；七根柱子對一條目標虛線，超出那段淺一點的藍＋「+N」（單日多吃不用紅）；
   還沒到的日子虛線框畫在打平的高度、框裡寫數字；沒記完的日子虛線邊、星期字虛線底線，那欄點了跳到那天。圖下不寫字。
   數字的規則全在 lib/weekBudget.ts。class 一律 wkb-（wk- 是體重趨勢頁的，見 app.css）。 */
import { useMemo } from 'react'
import { headerText, weekBudget, type WeekDay } from '@/lib/weekBudget'
import type { WeekData } from '@/useWeekData'

const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日']
/** 目標線離底多高（px）；柱高照這個比例。上限留給「+N」標籤的位置（圖高 72）。 */
const TARGET_H = 40
const MAX_H = 56

const barH = (kcal: number, target: number) => (kcal <= 0 ? 0 : Math.max(3, Math.min(MAX_H, (kcal / target) * TARGET_H)))
/** 這天比目標多幾卡（取整後 > 0 才算）：畫面上的「+N」與讀屏那句用同一個判斷。 */
const overBy = (d: WeekDay, target: number) => (d.kind === 'future' || d.unlogged ? 0 : Math.max(0, Math.round(d.eaten - target)))

interface WeekCardProps {
  data: WeekData
  /** 今天（yyyy-mm-dd）。由今日頁傳下來：它在午夜會重畫一次，這裡跟著換。 */
  today: string
  target: number
  bmr: number
  onRetry: () => void
  onGoToDate: (iso: string) => void
}

export default function WeekCard({ data, today, target, bmr, onRetry, onGoToDate }: WeekCardProps) {
  const w = useMemo(
    () => (data.state === 'done' ? weekBudget(data.dates, today, target, bmr, data.byDate) : null),
    [data, today, target, bmr],
  )
  // 整週都在未來：不出這張卡（看的是明天、而明天是下週一）
  if (data.dates[0] > today) return null

  if (data.state !== 'done' || !w) {
    return (
      <section className="wkb" aria-label="這週">
        <div className="wkb-head">
          <span className="wkb-title">這週</span>
        </div>
        {data.state === 'error' ? (
          <p className="wkb-err">
            讀不到這週的紀錄
            <button className="wkb-retry" type="button" onClick={onRetry}>
              重試
            </button>
          </p>
        ) : (
          <>
            <div className="wkb-chart" aria-hidden="true" />
            <div className="wkb-days" aria-hidden="true">&nbsp;</div>
            <span className="sr-only">載入中…</span>
          </>
        )}
      </section>
    )
  }

  const total = headerText(w.header)
  const dayName = (d: WeekDay) => `週${WEEKDAY[w.days.indexOf(d)]}`
  const unlogged = w.days.filter((d) => d.unlogged)
  const summary = [
    `${total.startsWith('這週') ? total : `這週${total}`}${w.header.kind === 'even' ? '' : ' 卡'}`,
    ...w.days.filter((d) => overBy(d, target) > 0).map((d) => `${dayName(d)}多 ${overBy(d, target)} 卡`),
    unlogged.length > 0 ? `沒記完：${unlogged.map(dayName).join('、')}` : '',
    w.planPerDay !== null ? `之後每天約 ${w.planPerDay} 卡` : '',
  ].filter(Boolean)

  return (
    <section className={`wkb${w.red ? ' is-red' : ''}`} aria-label="這週">
      <div className="wkb-head">
        <span className="wkb-title">這週</span>
        <span className="wkb-total" data-kind={w.header.kind} aria-hidden="true">
          {total}
        </span>
      </div>
      <p className="sr-only">{summary.join('；')}</p>
      <div className="wkb-chart">
        <span className="wkb-line" aria-hidden="true" style={{ bottom: TARGET_H }} />
        <div className="wkb-cols">
          {w.days.map((d, i) => (
            <Col key={d.date} d={d} i={i} target={target} red={w.red} onGoToDate={onGoToDate} />
          ))}
        </div>
      </div>
      <div className="wkb-days" aria-hidden="true">
        {w.days.map((d, i) => (
          <span key={d.date} className={`wkb-day${d.kind === 'today' ? ' is-today' : ''}${d.unlogged ? ' is-unlogged' : ''}`}>
            {WEEKDAY[i]}
          </span>
        ))}
      </div>
    </section>
  )
}

function Col({ d, i, target, red, onGoToDate }: { d: WeekDay; i: number; target: number; red: boolean; onGoToDate: (iso: string) => void }) {
  // 還沒到、沒有預先記錄：打平框（這週已超過就寫「—」，框停在目標線）
  if (d.kind === 'future' && !d.prelogged) {
    const h = d.plan === null ? TARGET_H : barH(d.plan, target)
    return (
      <div className="wkb-col" data-wk-date={d.date}>
        <span className="wkb-bar is-plan" style={{ height: h }} aria-hidden="true">
          <em>{red || d.plan === null ? '—' : d.plan}</em>
        </span>
      </div>
    )
  }
  const h = barH(d.eaten, target)
  const over = overBy(d, target)
  const above = over > 0 ? h - TARGET_H : 0
  const cls = `wkb-bar${d.kind === 'today' ? ' is-today' : ''}${d.prelogged ? ' is-pre' : ''}${d.unlogged ? ' is-unlogged' : ''}`
  const bar = (
    <>
      {over > 0 && (
        <span className="wkb-tag" aria-hidden="true">
          +{over}
        </span>
      )}
      <span className={cls} style={{ height: Math.max(h, d.unlogged ? 6 : 0) }} aria-hidden="true">
        {above > 0 && <span className="wkb-above" style={{ height: above }} />}
      </span>
    </>
  )
  if (d.unlogged) {
    return (
      <button className="wkb-col is-btn" type="button" data-wk-date={d.date} aria-label={`週${WEEKDAY[i]}沒記完，去看那天`} onClick={() => onGoToDate(d.date)}>
        {bar}
      </button>
    )
  }
  return (
    <div className="wkb-col" data-wk-date={d.date}>
      {bar}
    </div>
  )
}
