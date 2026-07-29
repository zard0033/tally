/* 今日頁：熱量量尺＋三大營養素條＋餐別時間軸＋左滑刪除。
   行為與視覺對齊 DESIGN.md v2.1：日期區「週二 7/28」＋回今天安靜文字鈕；
   左滑刪除自 v2.1 改用 motion drag 手刻（取代 react-swipeable-list——那個套件拖曳中
   每一幀改 trailing actions 的 width，等於每幀觸發版面重排，真機體感與 iOS 有明顯落差；
   motion 這條是純 transform，走合成層）。計算全部交給 src/lib/formulas.ts。 */
import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion, type PanInfo } from 'motion/react'
import type { IntakeRow } from '@/lib/api'
import { localDate, shiftDate, weekdayDate } from '@/lib/dates'
import { macroExceeds, num, pct, sumIntake } from '@/lib/formulas'
import { defaultMeal, MEALS, type MealKey } from '@/lib/meals'
import type { TodayProps } from './types'

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const MACRO_LABEL: Record<'protein' | 'fat' | 'carb', string> = { protein: '蛋白質', fat: '脂肪', carb: '碳水' }

/* 左滑的三個距離。REVEAL＝44px 圓鈕＋兩側留白，就是「開啟」時停下來的位置；
   OPEN_AT＝放手時超過它就吸附開啟（拖不到一半視為反悔）；
   FULL_AT＝拖過列寬這個比例放手，直接刪除（iOS 提醒事項的滑到底行為，配 undo 才安全）。 */
const REVEAL = 56
const OPEN_AT = 24
const FULL_AT = 0.45
const EASE = [0.4, 0, 0.2, 1] as const

const DeleteIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
)

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

  /* 左滑刪除只有一個狀態：哪一列是開的。v2.0 曾拆成 raisedId／openingId／manualOpenId
     三個並行 id，是因為當時的套件沒有程式化開合 API，觸控與鍵盤只能各走各的路；
     改成自己控制 x 位移之後，兩條路徑寫的是同一個 openId，「開一列自動關他列」
     也就不必再維護一份 close 函式的 Map——單值 state 天生只能有一列是開的。 */
  const [openId, setOpenId] = useState<number | null>(null)
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<number>>(new Set())

  const toggleOpen = useCallback((id: number) => setOpenId((prev) => (prev === id ? null : id)), [])

  const handleDelete = useCallback(
    (id: number) => {
      // 連點守衛：刪除是破壞性動作，而樂觀移除到那一列真的消失中間有一段動畫時間
      if (deletingIds.has(id)) return
      setDeletingIds((prev) => new Set(prev).add(id))
      setOpenId((prev) => (prev === id ? null : prev))
      onDeleteIntake(id)
    },
    [deletingIds, onDeleteIntake],
  )

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
          renderTimeline(rows, { openId, deletingIds, justAddedIds, onOpenSheet, toggleOpen, handleDelete })
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
  openId: number | null
  deletingIds: ReadonlySet<number>
  justAddedIds: ReadonlySet<number>
  onOpenSheet: (meal: MealKey) => void
  toggleOpen: (id: number) => void
  handleDelete: (id: number) => void
}

/* 一列品項。位移層是 motion.div（純 transform，不動 layout），刪除鈕壓在它底下，
   滑開才露出來——這是「覆蓋式」的反面做法：實際上是內容讓開，不是鈕蓋上去，
   但視覺結果一樣而且不必在鈕上做位移動畫。開合狀態由父層的 openId 單一決定，
   `animate` 負責放手後吸附到位，拖曳中則由 drag 手勢直接接管 x。 */
function SwipeRow({
  row,
  name,
  vendor,
  qty,
  open,
  deleting,
  justAdded,
  onToggle,
  onDelete,
}: {
  row: IntakeRow
  name: string
  vendor: string | null
  qty: number
  open: boolean
  deleting: boolean
  justAdded: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const draggedRef = useRef(false)
  const [armed, setArmed] = useState(false)
  const quick = reduceMotion()

  const fullSwipeAt = () => (rowRef.current?.offsetWidth ?? 320) * FULL_AT

  function handleDragEnd(_e: unknown, info: PanInfo) {
    setArmed(false)
    // 拖過列寬 45% 放手＝直接刪除（有 undo 兜底，見 App.tsx 的 pendingDelete）
    if (info.offset.x < -fullSwipeAt()) {
      onDelete()
      return
    }
    // 甩一下就開：速度夠快時不要求拖滿距離，否則短促的手勢會被判成反悔
    const flung = info.velocity.x < -320
    onToggleTo(info.offset.x < -OPEN_AT || flung)
  }

  function onToggleTo(next: boolean) {
    if (next !== open) onToggle()
  }

  return (
    <div className={`item-row${open ? ' is-open' : ''}${armed ? ' is-armed' : ''}`} ref={rowRef}>
      <button
        className="item-delete"
        type="button"
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        disabled={deleting}
        aria-label={`刪除 ${name} 這一筆`}
        onClick={onDelete}
      >
        <DeleteIcon />
      </button>
      <motion.div
        className="item-slide"
        drag="x"
        dragDirectionLock
        dragMomentum={false}
        dragConstraints={{ left: -280, right: 0 }}
        dragElastic={{ left: 0.4, right: 0 }}
        animate={{ x: open ? -REVEAL : 0 }}
        transition={quick ? { duration: 0 } : { duration: (open ? 160 : 220) / 1000, ease: EASE }}
        onDragStart={() => {
          draggedRef.current = true
        }}
        onDrag={(_e, info) => setArmed(info.offset.x < -fullSwipeAt())}
        onDragEnd={handleDragEnd}
      >
        <button
          className={`item-content${justAdded ? ' just-added' : ''}`}
          type="button"
          aria-expanded={open}
          onClick={() => {
            // 拖曳結束後瀏覽器仍會補一個 click，這裡吃掉它，免得滑開的同時又切了開合
            if (draggedRef.current) {
              draggedRef.current = false
              return
            }
            onToggle()
          }}
        >
          <span className="nm">
            {name}
            {vendor && <span className="vendor"> {vendor}</span>}
            {qty !== 1 && <span className="qty"> ×{qty}</span>}
          </span>
          <span className="kc">{Math.round(num(row.kcal) * qty)}</span>
        </button>
      </motion.div>
    </div>
  )
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
                    {/* 刪除那一列淡出、其餘用 layout 的 FLIP 滑上來——兩者都只動 transform／
                        opacity，沒有動 height（DESIGN.md「不動 layout 屬性」）。 */}
                    <AnimatePresence initial={false}>
                      {items.map((r) => {
                        const name = r.foods?.name ?? '（食物已刪除）'
                        const dup = (nameCount.get(name) ?? 0) > 1 ? (r.foods?.vendor ?? null) : null
                        return (
                          <motion.li
                            className="item"
                            data-row={r.id}
                            key={r.id}
                            layout
                            exit={{ opacity: 0, x: -32 }}
                            transition={{ duration: 0.22, ease: EASE }}
                          >
                            <SwipeRow
                              row={r}
                              name={name}
                              vendor={dup}
                              qty={num(r.qty)}
                              open={h.openId === r.id}
                              deleting={h.deletingIds.has(r.id)}
                              justAdded={h.justAddedIds.has(r.id)}
                              onToggle={() => h.toggleOpen(r.id)}
                              onDelete={() => h.handleDelete(r.id)}
                            />
                          </motion.li>
                        )
                      })}
                    </AnimatePresence>
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
