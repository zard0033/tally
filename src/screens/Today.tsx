/* 今日頁：熱量量尺＋三大營養素條＋餐別時間軸＋左滑刪除。
   行為與視覺對齊 DESIGN.md v2.1：日期區「週二 7/28」＋回今天安靜文字鈕；
   左滑刪除自 v2.1 改用 motion drag 手刻（取代 react-swipeable-list——那個套件拖曳中
   每一幀改 trailing actions 的 width，等於每幀觸發版面重排，真機體感與 iOS 有明顯落差；
   motion 這條是純 transform，走合成層）。計算全部交給 src/lib/formulas.ts。 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion, useMotionValue, type PanInfo } from 'motion/react'
import type { IntakeRow } from '@/lib/api'
import { localDate, shiftDate, weekdayDate } from '@/lib/dates'
import { DUR, sec } from '@/lib/durations'
import { macroExceeds, num, pct, sumIntake } from '@/lib/formulas'
import { MEALS, type Meal, type MealKey } from '@/lib/meals'
import { normalizeQty } from '@/lib/quantity'
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

/* 編輯份量的觸發是「無位移的長按」，刻意不擴寬 item-content 塞第二顆按鈕、也不碰
   滑動刪除那段（REVEAL/OPEN_AT/FULL_AT）——那段手勢邏輯已經是三版血淚換來的穩定態，
   長按走的是完全獨立的 pointerdown/pointerup 計時器，跟 drag 手勢只有「互相取消」這一條
   耦合（見 SwipeRow 的 clearLongPress 呼叫點）。500ms 是常見的長按門檻（iOS/Android
   系統手勢都落在這附近），短於它容易跟「按住看外框」的正常停留誤觸。 */
const LONG_PRESS_MS = 500
/** 手指/滑鼠移動超過這個距離就不算長按——這是**備援**門檻，不是實際生效的那一道。
 *  真正先擋下大部分「移動」的是 framer 自己的手勢辨識：drag="x" 一旦判定成拖曳，
 *  onDragStart／onDrag 會立刻呼叫 clearLongPress()，而 framer 內部判定拖曳的位移門檻
 *  遠小於這裡的 10px（fresh-context verifier 逐級量測：3px 起 framer 就會搶先取消，
 *  10px 這道判斷實務上幾乎輪不到它生效，2026-08-02 收案前發現）。**保留它的理由**：
 *  drag="x" 搭配 dragDirectionLock 讓瀏覽器保留原生垂直觸控捲動，那種情況下 framer
 *  完全不會介入（不 setPointerCapture、onDragStart 也不會觸發），此時就只剩這裡的
 *  pointermove 在擋——這是它唯一真正派上用場的場景，不是「10px 容忍」的一般性描述。 */
const LONG_PRESS_MOVE_TOLERANCE = 10

/** 動效時長讀 app.css 的 token，reduced-motion 時降到近乎 0——跟 Settings.tsx 的
 *  tokenMs 同一套做法（該檔案自建 sheet 沒有共用元件可以 import，這裡編輯份量 sheet
 *  同樣是自建覆蓋層，就地複製這一小段，不為了三行邏輯拉一個新的共用檔）。 */
function tokenMs(name: string, fallback: number): number {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 0.01
  const t = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
  return Number.isFinite(t) ? t : fallback
}
const editCloseDurationMs = () => tokenMs('--dur-mid', 220)
const editScrimFadeMs = () => tokenMs('--dur-fast', 100)

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
    onUpdateIntakeQty,
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

  /* 編輯份量 sheet：自建覆蓋層，不走 vaul（跟 Settings.tsx 的記體重／身體參數 sheet
     同一套地基裁決，理由一樣——這裡只需要一顆 qty stepper 加一顆存入鈕，不值得為它
     多背 LogSheet 那整套 Drawer.Root/Portal/VAUL_TRANSITION_CSS）。開合／退場動畫
     直接複製 Settings.tsx 的 opening/closing + inline animation shorthand 那一套。 */
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null)
  const [editClosing, setEditClosing] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [editErr, setEditErr] = useState<string | null>(null)
  const [editQty, setEditQty] = useState(1)
  const [editQtyDraft, setEditQtyDraft] = useState('1')
  const editOpenerRef = useRef<HTMLElement | null>(null)
  const editDialogRef = useRef<HTMLDivElement>(null)
  const editCloseTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => {
    if (editCloseTimer.current !== undefined) window.clearTimeout(editCloseTimer.current)
  }, [])

  // sheet 開啟時把焦點交給對話框本身，跟 Settings.tsx 一致
  useEffect(() => {
    if (editing && !editClosing) editDialogRef.current?.focus()
  }, [editing, editClosing])

  // Esc 關閉：手勢／點遮罩之外的鍵盤路徑
  useEffect(() => {
    if (!editing) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeEditQtySheet()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editClosing])

  const openEditQty = useCallback((row: IntakeRow, name: string, opener: HTMLElement | null) => {
    if (editCloseTimer.current !== undefined) window.clearTimeout(editCloseTimer.current)
    editOpenerRef.current = opener
    setEditErr(null)
    setEditBusy(false)
    setEditClosing(false)
    const q = num(row.qty)
    setEditQty(q)
    setEditQtyDraft(String(q))
    setEditing({ id: row.id, name })
  }, [])

  function closeEditQtySheet() {
    if (!editing || editClosing) return
    setEditClosing(true)
    const opener = editOpenerRef.current
    if (editCloseTimer.current !== undefined) window.clearTimeout(editCloseTimer.current)
    editCloseTimer.current = window.setTimeout(() => {
      setEditing(null)
      setEditClosing(false)
      opener?.focus()
    }, editCloseDurationMs())
  }

  // 打字途中不正規化，理由與 LogSheet 的 handleQtyInput 相同：中間態被改掉游標會跳走
  function handleEditQtyInput(raw: string) {
    setEditQtyDraft(raw)
    const n = Number(raw.trim())
    if (Number.isFinite(n) && n > 0) setEditQty(n)
  }
  function handleEditQtyBlur(raw: string) {
    const n = normalizeQty(raw)
    setEditQty(n)
    setEditQtyDraft(String(n))
  }
  function stepEditQty(dir: 1 | -1) {
    const next = normalizeQty(editQty + dir)
    setEditQty(next)
    setEditQtyDraft(String(next))
  }

  async function submitEditQty() {
    if (!editing || editBusy) return
    setEditBusy(true)
    setEditErr(null)
    try {
      await onUpdateIntakeQty(editing.id, editQty)
      closeEditQtySheet()
    } catch (e) {
      setEditBusy(false)
      setEditErr(e instanceof Error ? e.message : String(e))
    }
  }

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
          renderTimeline(rows, currentDate, {
            openId,
            justAddedIds,
            onOpenSheet,
            toggleOpen,
            handleDelete,
            openEditQty,
          })
        )}
      </div>

      {editing && (
        <div id="edit-qty-sheet-root">
          <button
            type="button"
            className="scrim"
            aria-label="關閉"
            style={
              editClosing
                ? { animation: `scrim-out ${editScrimFadeMs()}ms var(--ease-sheet) both` }
                : undefined
            }
            onClick={closeEditQtySheet}
          />
          <div
            ref={editDialogRef}
            className={`sheet${editClosing ? '' : ' opening'}`}
            style={
              editClosing
                ? { animation: `sheet-out ${editCloseDurationMs()}ms var(--ease-sheet) both` }
                : undefined
            }
            role="dialog"
            aria-modal="true"
            aria-label={`編輯份量：${editing.name}`}
            tabIndex={-1}
          >
            <div className="handle" aria-hidden="true" />
            <div className="sheet-head">
              <span className="sheet-title">編輯份量</span>
              <button type="button" className="icon-btn" aria-label="關閉" onClick={closeEditQtySheet}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="form-wrap">
              <p className="note">{editing.name}</p>
              <div className="qty-stepper">
                <button
                  className="qty-btn"
                  type="button"
                  disabled={editQty <= 1}
                  aria-label="減少份量"
                  onClick={() => stepEditQty(-1)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12h14" />
                  </svg>
                </button>
                <input
                  className="qty-value"
                  type="text"
                  inputMode="decimal"
                  aria-label="份量"
                  value={editQtyDraft}
                  onChange={(e) => handleEditQtyInput(e.target.value)}
                  onBlur={(e) => handleEditQtyBlur(e.target.value)}
                />
                <button
                  className="qty-btn"
                  type="button"
                  aria-label="增加份量"
                  onClick={() => stepEditQty(1)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="confirm-wrap">
              {editErr && (
                <p className="sheet-error" role="alert">
                  存不進去：{editErr}
                </p>
              )}
              <button type="button" className="pick-bar-btn" disabled={editBusy} onClick={() => void submitEditQty()}>
                {editBusy ? '存入中…' : '存入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface TimelineHelpers {
  openId: number | null
  justAddedIds: ReadonlySet<number>
  onOpenSheet: (meal: MealKey) => void
  toggleOpen: (id: number) => void
  handleDelete: (id: number) => void
  openEditQty: (row: IntakeRow, name: string, opener: HTMLElement | null) => void
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
  onEdit,
}: {
  row: IntakeRow
  name: string
  vendor: string | null
  qty: number
  open: boolean
  justAdded: boolean
  onToggle: () => void
  onDelete: () => void
  onEdit: (opener: HTMLElement | null) => void
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

  /* 編輯份量走長按，跟左滑刪除是兩條獨立的觸發路徑，只在「取消對方」這一點耦合：
     drag 一旦被判定成真的拖曳（onDragStart／onDrag），長按計時器就要被取消，
     不然放手時兩件事一起發生。反過來，長按計時器本身完全不碰 x／REVEAL 那組手勢邏輯。 */
  const longPressTimer = useRef<number | null>(null)
  const longPressStart = useRef<{ x: number; y: number } | null>(null)
  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    longPressStart.current = null
  }, [])
  /* 沒有這個 unmount 清理，計時器會在這一列已經卸載之後（換日期、退場動畫跑完、
     刪除…任何讓這個 SwipeRow 從樹上消失的原因）繼續倒數，時間到了照樣對一個
     使用者畫面上早就看不到的品項開編輯 sheet，存入時送出的 PATCH 是打對 id，
     但畫面停在切走前的快照，直到重整頁面才會發現資料其實已經被改了
     （fresh-context verifier 用真實 pointerdown → 卸載 → 等計時器觸發重現，
     2026-08-02 收案前抓到）。 */
  useEffect(() => clearLongPress, [clearLongPress])

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

  // 長按計時器觸發到使用者實際放手之間隔多久，因人而異（看到 sheet 彈出來的反應時間、
  // 手指本來就沒那麼快抬起）——不能假設「觸發後 150ms 內一定會放手」。跟 handleDragEnd
  // 同一套 v3 手法：計時器一觸發先把 blockClickUntil 設 Infinity（放手前一律擋），
  // 放手當下（handlePointerUp）才改成「現在 + CLICK_GRACE_MS」讓它自然到期，這樣
  // grace window 永遠是從「真的放手那一刻」起算，不會因為使用者按住比較久就提早過期、
  // 讓補來的 click 漏網把底下這一列的滑動 reveal 切開（真機實測重現：長按開 sheet 前
  // 會先看到刪除鈕一閃）。**pointerup／pointercancel／pointerleave 三個收尾事件都要走
  // handlePointerUp**，不能只接 pointerup——sheet 一開就整片 scrim 蓋住這一列
  // （z-index 10），button 沒有 setPointerCapture，放手時 hit-test 落在 scrim 上，
  // 這顆按鈕自己的 onPointerUp 根本不會觸發，只會收到 leave／cancel；只接 pointerup
  // 會讓 Infinity 卡死出不來，之後這一列的 tap-to-reveal 永久失效直到觸發一次 drag
  // （precommit-review 抓到，這是這次修復自己引入的迴歸）。
  const longPressFired = useRef(false)

  function startLongPress(e: ReactPointerEvent<HTMLButtonElement>) {
    // 只認主要輸入（左鍵／單一觸點）——沒有這道檢查，桌機按住右鍵、或多點觸控的
    // 第二根手指都會被當成長按觸發，且第二根手指的座標還會覆蓋 longPressStart，
    // 讓位移偵測基準跑掉（precommit-review 抓到）
    if (e.button !== 0 || !e.isPrimary) return
    const opener = e.currentTarget
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current)
    longPressFired.current = false
    longPressStart.current = { x: e.clientX, y: e.clientY }
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null
      longPressStart.current = null
      longPressFired.current = true
      blockClickUntil.current = Infinity
      onEdit(opener)
    }, LONG_PRESS_MS)
  }
  function handlePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const start = longPressStart.current
    if (!start) return
    if (Math.abs(e.clientX - start.x) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(e.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE) {
      clearLongPress()
    }
  }
  function handlePointerUp() {
    if (longPressFired.current) {
      blockClickUntil.current = Date.now() + CLICK_GRACE_MS
      longPressFired.current = false
    }
    clearLongPress()
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
          clearLongPress()
        }}
        onDrag={() => {
          setArmed(x.get() < -fullSwipeAt())
          clearLongPress()
        }}
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
          onPointerDown={startLongPress}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
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
                        onEdit={(opener) => h.openEditQty(r, name, opener)}
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
