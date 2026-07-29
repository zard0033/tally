/* 今日頁：熱量量尺＋三大營養素條＋餐別時間軸＋左滑刪除。
   行為與視覺對齊 DESIGN.md v2.0（樣張 sample-v2-today.html T1／R1）：
   日期區改「週二 7/28」＋回今天安靜文字鈕；左滑刪除改 react-swipeable-list（iOS 模式），
   取代舊版 CSS scroll-snap 手刻。計算全部交給 src/lib/formulas.ts，這裡不重新推導捨入或破表判定。 */
import { useEffect, useRef, useState } from 'react'
import { SwipeableListItem, SwipeAction, TrailingActions, Type } from 'react-swipeable-list'
import type { IntakeRow } from '@/lib/api'
import { localDate, shiftDate, weekdayDate } from '@/lib/dates'
import { macroExceeds, num, pct, sumIntake } from '@/lib/formulas'
import { defaultMeal, MEALS, type MealKey } from '@/lib/meals'
import type { TodayProps } from './types'

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const MACRO_LABEL: Record<'protein' | 'fat' | 'carb', string> = { protein: '蛋白質', fat: '脂肪', carb: '碳水' }

/* react-swipeable-list 的型別定義沒有列出 `resetState`（package 的 propTypes 有，
   d.ts 沒補齊）——它是拿到該列 playReturnAnimation 的唯一管道，用來在「點另一列」
   時把真的滑開的列關掉。用一個薄型別擴充接住，不用 any 到底。 */
type SwipeItemExtraProps = { resetState?: (close: () => void) => void }
const SwipeItem = SwipeableListItem as unknown as React.ComponentType<
  React.ComponentProps<typeof SwipeableListItem> & SwipeItemExtraProps
>

const DeleteIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
)

/** --dur-base 現值（ms），跟著 CSS token 走，不在 JS 端另外寫死一份數字。 */
function durBase(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-base')) || 160
}

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

  /* 「回今天」按下後原本的鈕會被靜態 span 取代（unmount），焦點跟著掉回 body；
     「後一天」按到今天當下也會翻 disabled，同樣把焦點甩掉——兩條路徑都用這個容器
     接住焦點（tabIndex=-1：只接受程式化 focus，不進 Tab 順序，不干擾原本的鍵盤走位）。 */
  const dateRegionRef = useRef<HTMLDivElement>(null)
  const willLandOnToday = (days: number) => shiftDate(currentDate, days) === localDate()

  /* 左滑刪除的三個狀態，理由見檔尾委派回報：
     - closeFns：每一列 SwipeableListItem 的 playReturnAnimation，供「開別列時關掉真的滑開的列」用
     - raisedId／openingId：底色 --card→--raised 的那一列，openingId 只在剛開的那一刻套用
       較短的 --dur-base，其餘時候（含關閉）走 CSS 預設的 --dur-mid
     - manualOpenId：點擊品項內容（鍵盤／非觸控路徑）手動露出的刪除鈕；套件本身沒有
       程式化開合的公開 API，這條路徑是另外補的，跟真正的滑動手勢互不干擾
       （real swipe 一開始就會把 manualOpenId 清掉，見 handleSwipeStart） */
  const closeFns = useRef(new Map<number, () => void>())
  const [raisedId, setRaisedId] = useState<number | null>(null)
  const [openingId, setOpeningId] = useState<number | null>(null)
  const [manualOpenId, setManualOpenId] = useState<number | null>(null)
  const openingTimer = useRef<number | undefined>(undefined)
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<number>>(new Set())

  // 品項被刪掉／換日期後，Map 裡對應不到任何列的殘留項清掉，避免無限累積
  useEffect(() => {
    const ids = new Set((rows ?? []).map((r) => r.id))
    closeFns.current.forEach((_fn, id) => {
      if (!ids.has(id)) closeFns.current.delete(id)
    })
  }, [rows])

  function closeOthers(exceptId: number) {
    closeFns.current.forEach((fn, id) => {
      if (id !== exceptId) fn()
    })
  }

  function markOpening(id: number) {
    setOpeningId(id)
    window.clearTimeout(openingTimer.current)
    openingTimer.current = window.setTimeout(() => setOpeningId(null), reduceMotion() ? 0 : durBase())
  }

  function toggleManual(id: number) {
    if (manualOpenId === id) {
      setManualOpenId(null)
      setRaisedId((prev) => (prev === id ? null : prev))
      return
    }
    closeOthers(id)
    setManualOpenId(id)
    setRaisedId(id)
    markOpening(id)
  }

  function handleSwipeStart(id: number) {
    closeOthers(id)
    setManualOpenId(null)
  }

  function handleSwipeProgress(id: number, progress: number) {
    if (progress > 0) {
      if (raisedId !== id) {
        setRaisedId(id)
        markOpening(id)
      }
    } else if (raisedId === id) {
      setRaisedId(null)
    }
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
        <h1 className="today">日記</h1>
        <div className="datectl" ref={dateRegionRef} tabIndex={-1}>
          <button
            type="button"
            className="date-arrow"
            aria-label="前一天"
            onClick={() => onShiftDate(-1)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <span className="date-text">{weekdayDate(currentDate)}</span>
          <span className="datectl-spacer" />
          {isToday ? (
            <span className="date-today-label">今天</span>
          ) : (
            <button
              type="button"
              className="date-today-btn"
              onClick={() => {
                onGoToDate(localDate())
                // 這顆鈕自己會被今天狀態的靜態 span 取代（unmount），焦點要在同一個
                // click handler 裡搶先移到還會留著的容器，不能等 re-render 完才做
                dateRegionRef.current?.focus()
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
              回今天
            </button>
          )}
          <button
            type="button"
            className="date-arrow"
            aria-label="後一天"
            disabled={isToday}
            onClick={() => {
              const landOnToday = willLandOnToday(1)
              onShiftDate(1)
              if (landOnToday) dateRegionRef.current?.focus()
            }}
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
            raisedId,
            openingId,
            manualOpenId,
            deletingIds,
            justAddedIds,
            onOpenSheet,
            toggleManual,
            handleDelete,
            handleSwipeStart,
            handleSwipeProgress,
            registerClose: (id, fn) => closeFns.current.set(id, fn),
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
  raisedId: number | null
  openingId: number | null
  manualOpenId: number | null
  deletingIds: ReadonlySet<number>
  justAddedIds: ReadonlySet<number>
  onOpenSheet: (meal: MealKey) => void
  toggleManual: (id: number) => void
  handleDelete: (id: number) => void
  handleSwipeStart: (id: number) => void
  handleSwipeProgress: (id: number, progress: number) => void
  registerClose: (id: number, fn: () => void) => void
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
                      const raised = h.raisedId === r.id
                      const opening = h.openingId === r.id
                      const manualOpen = h.manualOpenId === r.id
                      const deleteLabel = `刪除 ${name} 這一筆`
                      return (
                        <li className={`item${h.justAddedIds.has(r.id) ? ' just-added' : ''}`} data-row={r.id} key={r.id}>
                          {/* is-raised／is-open 是兩個獨立狀態：真的滑動手勢只設 raised（底色），
                              是否露出我們自己的 click-reveal 鈕只看 manualOpen——否則真滑動時
                              這顆鈕會悄悄跟著疊上去，跟套件自己的 trailingActions 鈕重複 */}
                          <div className={`item-row${raised ? ' is-raised' : ''}${manualOpen ? ' is-open' : ''}${opening ? ' opening' : ''}`}>
                            <SwipeItem
                              listType={Type.IOS}
                              fullSwipe={false}
                              resetState={(close) => h.registerClose(r.id, close)}
                              onSwipeStart={() => h.handleSwipeStart(r.id)}
                              onSwipeProgress={(progress) => h.handleSwipeProgress(r.id, progress)}
                              trailingActions={
                                <TrailingActions>
                                  <SwipeAction destructive={false} onClick={() => h.handleDelete(r.id)}>
                                    <span className="item-delete swipe-reveal" aria-hidden="true">
                                      <DeleteIcon />
                                    </span>
                                  </SwipeAction>
                                </TrailingActions>
                              }
                            >
                              <button
                                className="item-content"
                                type="button"
                                aria-expanded={manualOpen}
                                onClick={() => h.toggleManual(r.id)}
                              >
                                <span className="nm">
                                  {name}
                                  {dup && <span className="vendor"> {r.foods?.vendor}</span>}
                                  {q !== 1 && <span className="qty"> ×{q}</span>}
                                </span>
                                <span className="kc">{Math.round(num(r.kcal) * q)}</span>
                              </button>
                            </SwipeItem>
                            <button
                              className="item-delete click-reveal"
                              type="button"
                              tabIndex={manualOpen ? 0 : -1}
                              aria-hidden={!manualOpen}
                              disabled={h.deletingIds.has(r.id)}
                              aria-label={deleteLabel}
                              onClick={() => h.handleDelete(r.id)}
                            >
                              <DeleteIcon />
                            </button>
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
