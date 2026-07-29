/* 今日頁：熱量量尺＋三大營養素條＋餐別時間軸＋左滑刪除。
   行為與視覺 1:1 對齊 legacy/app.js 的 renderToday／renderMacro／renderTimeline
   與 legacy/app.css 的 .item-track scroll-snap 刪除手勢，樣張見 mockup.html。
   計算全部交給 src/lib/formulas.ts，不在這裡重新推導捨入或破表判定。 */
import { useRef, useState, type MutableRefObject } from 'react'
import type { IntakeRow } from '@/lib/api'
import { dateTitle, localDate } from '@/lib/dates'
import { macroExceeds, num, pct, sumIntake } from '@/lib/formulas'
import { defaultMeal, MEALS, type MealKey } from '@/lib/meals'
import type { TodayProps } from './types'

/* .item-delete 的 min-width 56 ＋ 擋分數像素的 margin-left 1（app.css 同款註記） */
const DELETE_W = 57
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const MACRO_LABEL: Record<'protein' | 'fat' | 'carb', string> = { protein: '蛋白質', fat: '脂肪', carb: '碳水' }

export default function Today(props: TodayProps) {
  const {
    dayData,
    targets,
    currentDate,
    onShiftDate,
    onGoToDate,
    onOpenSheet,
    onDeleteIntake,
    justAddedIds,
  } = props

  const rows = dayData.rows
  const isToday = currentDate === localDate()

  /* 左滑刪除：每個 item-track 的 DOM ref，供 closeOtherTracks／revealDelete 直接操作 scrollLeft。
     刪除中的按鈕停用只是給個當下回饋——成功後那筆會整個從 rows 消失，失敗會被 App 換成全域 Notice，
     兩條路都不需要手動清掉這個 state。 */
  const trackRefs = useRef(new Map<number, HTMLDivElement>())
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<number>>(new Set())

  function closeOtherTracks(except: HTMLDivElement) {
    trackRefs.current.forEach((t) => {
      if (t !== except && t.scrollLeft !== 0) t.scrollLeft = 0
    })
  }

  function revealDelete(id: number) {
    const track = trackRefs.current.get(id)
    if (!track) return
    const open = track.scrollLeft > 8
    closeOtherTracks(track)
    track.scrollTo({ left: open ? 0 : DELETE_W, behavior: reduceMotion() ? 'auto' : 'smooth' })
  }

  function handleDelete(id: number) {
    setDeletingIds((prev) => new Set(prev).add(id))
    onDeleteIntake(id)
  }

  const eaten = rows ? sumIntake(rows) : null
  const eatenKcal = eaten ? Math.round(eaten.kcal) : null
  const targetKcal = Math.round(targets.kcal)
  const over = eatenKcal !== null && targetKcal - eatenKcal < 0

  return (
    <div className={`main${over ? ' is-over' : ''}`} data-screen="today">
      <header className="topbar">
        <h1 className="today">{dateTitle(currentDate)}</h1>
        <div className={`datectl${isToday ? '' : ' past'}`}>
          <button type="button" className="date-arrow" aria-label="前一天" onClick={() => onShiftDate(-1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <input
            className="date-input"
            type="date"
            aria-label="檢視日期"
            value={currentDate}
            onChange={(e) => {
              if (e.target.value) onGoToDate(e.target.value)
            }}
          />
          <button
            type="button"
            className="date-arrow"
            aria-label="後一天"
            disabled={isToday}
            onClick={() => onShiftDate(1)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </header>

      <section className="gauge" aria-label="今日熱量">
        <div className="gauge-top">
          <div>
            <div className="gauge-lead">{eatenKcal === null ? '還能吃' : !isToday ? '攝取' : over ? '超出' : '還能吃'}</div>
            <div aria-live="polite">
              <span className="gauge-num">
                {eatenKcal === null ? '—' : isToday ? Math.abs(targetKcal - eatenKcal) : eatenKcal}
              </span>
              <span className="gauge-unit">卡</span>
            </div>
          </div>
          <div
            className="gauge-side pair"
            aria-label={eatenKcal === null ? undefined : `已攝取 ${eatenKcal} 大卡，目標 ${targetKcal} 大卡`}
          >
            <span aria-hidden="true">
              <span className="cur">{eatenKcal ?? '—'}</span>
              <span className="sep">/</span>
              <span className="tgt">{targetKcal}</span>
            </span>
          </div>
        </div>
        <div className="bar" aria-hidden="true">
          <div className="fill" style={{ width: `${eaten ? pct(eaten.kcal, targets.kcal) : 0}%` }} />
        </div>
      </section>

      <section className="macros" aria-label="三大營養素">
        {(['protein', 'fat', 'carb'] as const).map((key) => {
          const cur = eaten ? eaten[key] : null
          const target = targets[key]
          const macroOver = cur !== null && macroExceeds(cur, target)
          const curTxt = cur === null ? '—' : cur.toFixed(1)
          const tgtTxt = String(Math.round(target))
          return (
            <div className={`macro${macroOver ? ' over' : ''}`} key={key}>
              <div className="lbl">{MACRO_LABEL[key]}</div>
              <div className="track-box" aria-hidden="true">
                <div className="track">
                  <div className="fill" style={{ width: `${cur === null ? 0 : pct(cur, target)}%` }} />
                </div>
              </div>
              <div
                className="val pair"
                aria-label={cur === null ? undefined : `${MACRO_LABEL[key]} ${curTxt} 克，${macroOver ? '超出目標' : '目標'} ${tgtTxt} 克`}
              >
                <span aria-hidden="true">
                  <span className="cur">{curTxt}</span>
                  <span className="sep">/</span>
                  <span className="tgt">{tgtTxt}</span>
                </span>
              </div>
            </div>
          )
        })}
      </section>

      <div className="timeline">
        {rows === null ? (
          <p className="muted">載入中…</p>
        ) : (
          renderTimeline(rows, {
            trackRefs,
            deletingIds,
            justAddedIds,
            onOpenSheet,
            revealDelete,
            handleDelete,
          })
        )}
      </div>

      <div className="cta-wrap">
        <button className="cta" type="button" onClick={() => onOpenSheet(defaultMeal())}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          記一筆
        </button>
      </div>
    </div>
  )
}

interface TimelineHelpers {
  trackRefs: MutableRefObject<Map<number, HTMLDivElement>>
  deletingIds: ReadonlySet<number>
  justAddedIds: ReadonlySet<number>
  onOpenSheet: (meal: MealKey) => void
  revealDelete: (id: number) => void
  handleDelete: (id: number) => void
}

function renderTimeline(rows: IntakeRow[], h: TimelineHelpers) {
  const byMeal = new Map<MealKey, IntakeRow[]>(MEALS.map((m) => [m.key, []]))
  for (const r of rows) byMeal.get(r.meal as MealKey)?.push(r)

  /* 三筆完全同名的「雞胸餐盒」只靠店家區分。今日頁常態不顯示店家，
     同一天出現兩筆同名時才非顯示不可，否則回頭核對或刪除都是盲的 */
  const nameCount = new Map<string, number>()
  for (const r of rows) {
    const n = r.foods?.name
    if (n) nameCount.set(n, (nameCount.get(n) ?? 0) + 1)
  }

  return (
    <>
      {MEALS.map((meal, i) => {
        const items = byMeal.get(meal.key) ?? []
        const done = items.length > 0
        const nextMeal = MEALS[i + 1]
        const nextDone = i < MEALS.length - 1 && (byMeal.get(nextMeal.key)?.length ?? 0) > 0

        return (
          <div className="node" key={meal.key}>
            <div className="rail" aria-hidden="true">
              <div className={`dot${done ? '' : ' todo'}`} />
              {i < MEALS.length - 1 && <div className={`line${nextDone ? '' : ' todo'}`} />}
            </div>
            <div className={`node-body${done ? '' : ' is-todo'}`}>
              {done ? (
                <>
                  <button className="node-head" type="button" onClick={() => h.onOpenSheet(meal.key)}>
                    <span className="node-name">{meal.label}</span>
                    <span className="node-kcal">{Math.round(sumIntake(items).kcal)}</span>
                  </button>
                  <ul className="items">
                    {items.map((r) => {
                      const q = num(r.qty)
                      const name = r.foods?.name ?? '（食物已刪除）'
                      const dup = (nameCount.get(name) ?? 0) > 1 && r.foods?.vendor
                      return (
                        <li className={`item${h.justAddedIds.has(r.id) ? ' just-added' : ''}`} data-row={r.id} key={r.id}>
                          <div
                            className="item-track"
                            ref={(el) => {
                              if (el) h.trackRefs.current.set(r.id, el)
                              else h.trackRefs.current.delete(r.id)
                            }}
                            onScroll={(e) => {
                              const track = e.currentTarget
                              if (track.scrollLeft > 8) {
                                h.trackRefs.current.forEach((t) => {
                                  if (t !== track && t.scrollLeft !== 0) t.scrollLeft = 0
                                })
                              }
                            }}
                          >
                            <div className="item-track-row">
                              <button className="item-content" type="button" onClick={() => h.revealDelete(r.id)}>
                                <span className="nm">
                                  {name}
                                  {dup && <span className="vendor"> {r.foods?.vendor}</span>}
                                  {q !== 1 && <span className="qty"> ×{q}</span>}
                                </span>
                                <span className="kc">{Math.round(num(r.kcal) * q)}</span>
                              </button>
                              <button
                                className="item-delete"
                                type="button"
                                disabled={h.deletingIds.has(r.id)}
                                aria-label={`刪除 ${name} 這一筆`}
                                onClick={() => h.handleDelete(r.id)}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </>
              ) : (
                <button className="todo-row" type="button" onClick={() => h.onOpenSheet(meal.key)}>
                  <span className="lb">{meal.label}</span>
                  <span className="chev" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </span>
                </button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
