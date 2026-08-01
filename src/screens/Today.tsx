/* 今日頁：熱量量尺＋三大營養素條＋餐別時間軸＋左滑刪除。
   行為與視覺對齊 DESIGN.md v2.1：日期區「週二 7/28」＋回今天安靜文字鈕；
   左滑刪除自 v2.1 改用 motion drag 手刻（取代 react-swipeable-list——那個套件拖曳中
   每一幀改 trailing actions 的 width，等於每幀觸發版面重排，真機體感與 iOS 有明顯落差；
   motion 這條是純 transform，走合成層）。計算全部交給 src/lib/formulas.ts。 */
import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, type PanInfo } from 'motion/react'
import type { IntakeRow } from '@/lib/api'
import { localDate, shiftDate, weekdayDate } from '@/lib/dates'
import { DUR, sec } from '@/lib/durations'
import { macroExceeds, num, pct, sumIntake } from '@/lib/formulas'
import { MEALS, type Meal, type MealKey } from '@/lib/meals'
import type { TodayProps } from './types'

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const MACRO_LABEL: Record<'protein' | 'fat' | 'carb', string> = { protein: '蛋白質', fat: '脂肪', carb: '碳水' }

/* 左滑的三個距離。REVEAL＝44px 圓鈕＋兩側留白，就是「開啟」時停下來的位置；
   OPEN_AT＝放手時超過它就吸附開啟（拖不到一半視為反悔）；
   FULL_AT＝拖過列寬這個比例放手，直接刪除（iOS 提醒事項的滑到底行為，配 undo 才安全）。 */
const REVEAL = 56
const OPEN_AT = 24
const FULL_AT = 0.45
/** 拖曳結束後這段時間內的 click 都當成「瀏覽器補的那一下」吃掉 */
const CLICK_GRACE_MS = 150
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

  const toggleOpen = useCallback((id: number) => setOpenId((prev) => (prev === id ? null : id)), [])

  /* 沒有 deletingIds 這種「刪除中」旗標了：刪除已改成樂觀移除，按下去那一列當場離開
     清單，不存在「按了沒反應所以再按一次」的窗口。連點同一列的守衛改放在 App.tsx
     的 handleDeleteIntake（比對待刪 id），那裡才是資料的真相。
     v2.1 第一版留了這個旗標，結果是**復原後該列永遠 disabled、再也刪不掉**——
     旗標只加不減，而復原會把那一列放回來（verifier 實測抓到）。 */
  const handleDelete = useCallback(
    (id: number) => {
      setOpenId((prev) => (prev === id ? null : prev))
      onDeleteIntake(id)
    },
    [onDeleteIntake],
  )

  const eaten = rows ? sumIntake(rows) : null
  const eatenKcal = eaten ? Math.round(eaten.kcal) : null
  const targetKcal = Math.round(targets.kcal)
  const over = eatenKcal !== null && targetKcal - eatenKcal < 0

  return (
    <div className={`main${over ? ' is-over' : ''}`} data-screen="today">
      {/* v2.4：日期組 `‹ 日期 › ` 包進一顆膠囊（.datectl 本身即容器），置中不受
          「回今天」影響——後者移到左端、脫離膠囊，絕對定位貼 .topbar 左邊距，
          與膠囊間距用 CSS padding 撐開，不吃版面流。今天時同位置不放東西。 */}
      <header className="topbar">
        {/* 「回今天」render 在膠囊**之前**：它視覺上在左端（絕對定位），DOM 順序必須跟著
            視覺順序走，否則 Tab 會先跳到右邊的箭頭再回頭跳左邊這顆（WCAG 2.4.3 焦點順序）。 */}
        {!isToday && (
          <button
            type="button"
            className="date-today-btn"
            onClick={() => {
              onGoToDate(localDate())
              // 這顆鈕自己會被 unmount（今天時同位置不放東西），焦點要在同一個
              // click handler 裡搶先移到還會留著的容器，不能等 re-render 完才做
              dateRegionRef.current?.focus()
            }}
          >
            回今天
          </button>
        )}
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
          <h1 className="date-title">{weekdayDate(currentDate)}</h1>
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
          renderTimeline(rows, currentDate, { openId, justAddedIds, onOpenSheet, toggleOpen, handleDelete })
        )}
      </div>
    </div>
  )
}

interface TimelineHelpers {
  openId: number | null
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
  justAdded,
  onToggle,
  onDelete,
}: {
  row: IntakeRow
  name: string
  vendor: string | null
  qty: number
  open: boolean
  justAdded: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  /* 「這次指標互動是不是拖曳」的旗標，dragStart 立起、dragEnd 之後延遲清掉。三個版本的血淚：
     v1 用純旗標、唯一歸零點是 click——拖曳後瀏覽器不保證補 click，漏一次旗標就永遠停在 true，
       之後每次真正的點擊都被靜默吃掉（precommit review 抓到）。
     v2 改成在 dragEnd 記時間戳擋 click——**擋不到**，因為 click 比 dragEnd 先到（實測：
       拖 100px 放手，click 先把列切開、dragEnd 再切一次，兩次抵銷成關閉，所以「拖了卻打不開」）。
     v3（現在）記一個「在此之前的 click 都不算」的時刻：dragStart 設 Infinity（拖曳中一律擋，
       不管 click 在 dragEnd 前後），dragEnd 改成現在 + CLICK_GRACE_MS 讓它自然到期。
       一個數字，不必管計時器生命週期。 */
  const blockClickUntil = useRef(0)
  const [armed, setArmed] = useState(false)
  const quick = reduceMotion()

  /* 門檻一律讀「這一列實際位移了多少」，不讀指標的原始位移 info.offset.x。
     dragDirectionLock 判定成縱向捲動時列根本不會動，但 offset.x 照樣累積——
     直向捲動只要帶一點左偏就會湊到刪除門檻，畫面毫無變化卻靜默刪掉一筆
     （verifier 實測重現：先下拉 20-90px 再左移 300px，transform 全程 none，品項少一筆）。
     x 這個 motion value 是位移的唯一真相，鎖在 Y 軸時它就是 0。 */
  const x = useMotionValue(0)
  /* 上限鎖在 dragConstraints 之內：寬版面上 45% 會超過 280px 的拖曳邊界，門檻就只剩
     彈性區搆得到，同一個手勢在手機與桌機的手感會不一樣 */
  const fullSwipeAt = () => Math.min((rowRef.current?.offsetWidth ?? 320) * FULL_AT, 200)

  function handleDragEnd(_e: unknown, info: PanInfo) {
    setArmed(false)
    blockClickUntil.current = Date.now() + CLICK_GRACE_MS
    const moved = x.get()
    // 拖過列寬 45% 放手＝直接刪除（有 undo 兜底，見 App.tsx 的 pendingDelete）
    if (moved < -fullSwipeAt()) {
      onDelete()
      return
    }
    // 甩一下就開：速度夠快時不要求拖滿距離，否則短促的手勢會被判成反悔。
    // 速度也要配 moved < 0 把關，否則縱向甩動時的 velocity.x 雜訊會誤判成開啟
    const flung = info.velocity.x < -320 && moved < 0
    onToggleTo(moved < -OPEN_AT || flung)
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
        aria-label={`刪除 ${name} 這一筆`}
        onClick={onDelete}
      >
        <DeleteIcon />
      </button>
      <motion.div
        className="item-slide"
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragMomentum={false}
        dragConstraints={{ left: -280, right: 0 }}
        dragElastic={{ left: 0.4, right: 0 }}
        animate={{ x: open ? -REVEAL : 0 }}
        transition={quick ? { duration: 0 } : { duration: sec(open ? DUR.base : DUR.mid), ease: EASE }}
        onDragStart={() => {
          blockClickUntil.current = Infinity
        }}
        onDrag={() => setArmed(x.get() < -fullSwipeAt())}
        onDragEnd={handleDragEnd}
      >
        <button
          className={`item-content${justAdded ? ' just-added' : ''}`}
          type="button"
          aria-expanded={open}
          onClick={() => {
            // 拖曳期間／剛結束時瀏覽器補的那個 click 吃掉，免得滑開的同時又切一次開合
            if (Date.now() < blockClickUntil.current) return
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

function renderTimeline(rows: IntakeRow[], date: string, h: TimelineHelpers) {
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
        const nextMeal = MEALS[i + 1]
        const nextDone = i < MEALS.length - 1 && (byMeal.get(nextMeal.key)?.length ?? 0) > 0
        return (
          <MealNode
            key={`${meal.key}-${date}`}
            meal={meal}
            items={items}
            nextDone={nextDone}
            isLast={i === MEALS.length - 1}
            nameCount={nameCount}
            h={h}
          />
        )
      })}
    </>
  )
}

/* 某餐目前有沒有紀錄，決定要畫 `.items` 清單還是 `.todo-row`。
   刪掉一餐**最後一筆**時 `items` 在同一個 render 內就從 1 變 0——如果直接拿
   `items.length > 0` 當開關，整段（含 AnimatePresence）跟著同一個 render 卸載，
   退場動畫連跑的機會都沒有（2026-07-31 實測：刪除後 10ms 內 `.todo-row` 就已經在畫面上，
   `.item` 完全沒有經過任何 opacity 過渡）。用 `lingering` 讓「翻成待記錄」延後到
   AnimatePresence 的 `onExitComplete` 才發生，其餘（2 筆以上互相 FLIP）不受影響——
   那條路徑 `hasItems` 從頭到尾是 true，不會觸發這個分支。

   **`lingering` 分不出「真的刪除」跟「切到另一天、那餐剛好是空的」**——後者也是
   `items.length` 從正變 0，會被誤判成刪除、誤放退場動畫（precommit review 2026-08-01
   抓到：`goToDate` 快取命中時不會 `setRows(null)`，時間軸不卸載，`MealNode` 本來只用
   `meal.key` 當 key 會被留著跨日期複用）。修法是 `renderTimeline` 呼叫端把 `key` 併上
   `date`（見上方 `key={`${meal.key}-${date}`}`）——換日期時每個 `MealNode` 強制重掛，
   `lingering`／`prevHasItems` 這兩顆 local state 自然歸零，只有同一天內真的按刪除
   才會觸發退場動畫。`AnimatePresence` 的 `initial={false}` 保證重掛不會誤放進場動畫。 */
function MealNode({
  meal,
  items,
  nextDone,
  isLast,
  nameCount,
  h,
}: {
  meal: Meal
  items: IntakeRow[]
  nextDone: boolean
  isLast: boolean
  nameCount: Map<string, number>
  h: TimelineHelpers
}) {
  const hasItems = items.length > 0
  const [prevHasItems, setPrevHasItems] = useState(hasItems)
  const [lingering, setLingering] = useState(false)
  if (hasItems !== prevHasItems) {
    setPrevHasItems(hasItems)
    if (prevHasItems && !hasItems) setLingering(true)
  }
  const done = hasItems || lingering

  return (
    <div className="node">
      <div className="rail" aria-hidden="true">
        <div className={`dot${done ? '' : ' todo'}`} />
        {!isLast && <div className={`line${nextDone ? '' : ' todo'}`} />}
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
              <AnimatePresence initial={false} onExitComplete={() => setLingering(false)}>
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
                      transition={reduceMotion() ? { duration: 0 } : { duration: sec(DUR.mid), ease: EASE }}
                    >
                      <SwipeRow
                        row={r}
                        name={name}
                        vendor={dup}
                        qty={num(r.qty)}
                        open={h.openId === r.id}
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
}
