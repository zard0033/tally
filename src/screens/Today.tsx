/* 今日頁：熱量量尺＋三大營養素條＋餐別時間軸＋左滑刪除。
   行為與視覺對齊 DESIGN.md v2.1：日期區「週二 7/28」＋回今天安靜文字鈕；
   左滑刪除自 v2.1 改用 motion drag 手刻（取代 react-swipeable-list——那個套件拖曳中
   每一幀改 trailing actions 的 width，等於每幀觸發版面重排，真機體感與 iOS 有明顯落差；
   motion 這條是純 transform，走合成層）。計算全部交給 src/lib/formulas.ts。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, type PanInfo } from 'motion/react'
import type { IntakeDetailPatch, IntakeRow } from '@/lib/api'
import { localDate, shiftDate, weekdayDate } from '@/lib/dates'
import { DUR, sec } from '@/lib/durations'
import { macroExceeds, num, pct, sumIntake } from '@/lib/formulas'
import { MEALS, type Meal, type MealKey } from '@/lib/meals'
import { normalizeQty } from '@/lib/quantity'
import type { TodayProps } from './types'

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const MACRO_LABEL: Record<'protein' | 'fat' | 'carb', string> = { protein: '蛋白質', fat: '脂肪', carb: '碳水' }
/* 就地編輯區的數字欄標籤。與新增食物表單同一組字（DESIGN.md「新增食物表單欄位」），
   單位帶在 label 上而不是欄位旁——欄位窄，額外的單位字會擠掉輸入空間。 */
type DetailKey = 'kcal' | 'protein' | 'fat' | 'carb'
const DETAIL_LABEL: Record<DetailKey, string> = {
  kcal: '熱量（卡）',
  protein: '蛋白質 g',
  fat: '脂肪 g',
  carb: '碳水 g',
}

/* 左滑的三個距離。REVEAL＝44px 圓鈕＋兩側留白，就是「開啟」時停下來的位置；
   OPEN_AT＝放手時超過它就吸附開啟（拖不到一半視為反悔）；
   FULL_AT＝拖過列寬這個比例放手，直接刪除（iOS 提醒事項的滑到底行為，配 undo 才安全）。 */
const REVEAL = 56
const OPEN_AT = 24
const FULL_AT = 0.45
/** 拖曳結束後這段時間內的 click 都當成「瀏覽器補的那一下」吃掉 */
const CLICK_GRACE_MS = 150
const EASE = [0.4, 0, 0.2, 1] as const

/* v2.20：編輯份量從「長按開全屏 sheet」改成「點按就地展開」，長按整套（500ms 計時器、
   位移備援門檻、與 drag 手勢的互相取消、開合／退場動畫的 token 讀取）連同 sheet 一起移除。
   拆掉的理由不只是版面——長按與 drag="x" 共用同一次 pointerdown，兩套手勢的仲裁是這個
   元件翻船最多次的地方（誤閃 reveal 修了兩輪仍在真機上重現）。點按走的是原生 click，
   沒有仲裁問題。左滑刪除那組手勢（REVEAL/OPEN_AT/FULL_AT）完全不動。 */

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
    onUpdateIntakeMeal,
    onUpdateIntakeDetail,
  } = props

  const rows = dayData.rows
  const isToday = currentDate === localDate()

  /* 「回今天」按下後原本的鈕會被靜態 span 取代（unmount），焦點跟著掉回 body；
     「後一天」按到今天當下也會翻 disabled，同樣把焦點甩掉——兩條路徑都用這個容器
     接住焦點（tabIndex=-1：只接受程式化 focus，不進 Tab 順序，不干擾原本的鍵盤走位）。 */
  const dateRegionRef = useRef<HTMLDivElement>(null)
  const willLandOnToday = (days: number) => shiftDate(currentDate, days) === localDate()

  /* 品項列同時只有一列是「活躍」的，而活躍有兩種樣子：左滑露出刪除鈕（swipe）、
     點按展開就地編輯（edit）。v2.0 曾拆成 raisedId／openingId／manualOpenId 三個並行
     id，v2.1 收斂成單一 openId；v2.20 加入編輯區後仍維持單值——把 mode 併進同一顆
     state（而不是再開一個 editingId），「開一列自動關他列」「同一列不會同時滑開又展開」
     這兩件事就都是單值 state 的自然結果，不必寫任何互斥邏輯。 */
  const [active, setActive] = useState<{ id: number; mode: 'swipe' | 'edit' } | null>(null)

  /* 點品項：已展開就收合；正滑開著則先收回滑動（iOS 的慣例是列滑開時點它等於取消），
     不直接跳進編輯——那一下點擊使用者多半是想關掉刪除鈕。 */
  const toggleEdit = useCallback((id: number) => {
    setEditErr(null)
    setActive((prev) => (prev?.id === id ? null : { id, mode: 'edit' }))
  }, [])
  const setSwipe = useCallback((id: number, open: boolean) => {
    setActive((prev) => (open ? { id, mode: 'swipe' } : prev?.id === id ? null : prev))
  }, [])
  const closeActive = useCallback(() => {
    setEditErr(null)
    setActive(null)
  }, [])

  /* 沒有 deletingIds 這種「刪除中」旗標了：刪除已改成樂觀移除，按下去那一列當場離開
     清單，不存在「按了沒反應所以再按一次」的窗口。連點同一列的守衛改放在 App.tsx
     的 handleDeleteIntake（比對待刪 id），那裡才是資料的真相。
     v2.1 第一版留了這個旗標，結果是**復原後該列永遠 disabled、再也刪不掉**——
     旗標只加不減，而復原會把那一列放回來（verifier 實測抓到）。 */
  const handleDelete = useCallback(
    (id: number) => {
      setActive((prev) => (prev?.id === id ? null : prev))
      onDeleteIntake(id)
    },
    [onDeleteIntake],
  )

  /* 就地編輯的失敗訊息存在**這一層**，不存在 ItemEditor 裡。
     `patchIntakeRow` 是「先送出、成功才更新畫面」，而 ItemEditor 會在收合／左滑／點另一列
     時卸載——錯誤若只活在它的 local state，「按了 + → 途中收合 → PATCH 失敗」這條路徑上
     `setErr` 會打在已卸載的元件上（no-op），`setRows` 也因為失敗沒跑，畫面靜靜退回舊值，
     使用者剛親眼看到 stepper 變 2，於是認定存好了（impeccable critique 抓到）。
     修法是把錯誤提到 Today：失敗時把那一列拉回展開，訊息才有地方顯示、也才活得比編輯區久。 */
  const [editErr, setEditErr] = useState<{ id: number; msg: string } | null>(null)
  const runEdit = useCallback(async (id: number, send: () => Promise<void>) => {
    try {
      await send()
      setEditErr((prev) => (prev?.id === id ? null : prev))
    } catch (e) {
      setEditErr({ id, msg: e instanceof Error ? e.message : String(e) })
      /* 訊息要有地方顯示，把那一列拉回來——但**不能蓋掉使用者這期間已經切去的別列**：
         這是 async 回呼的典型競態（送出 A 之後、reject 之前使用者點開了 B），窗口窄但
         代價是把他正在操作的編輯區突然關掉（precommit review 抓到）。 */
      setActive((prev) => (prev && prev.id !== id ? prev : { id, mode: 'edit' }))
      throw e // 讓 ItemEditor 回滾自己的樂觀值
    }
  }, [])

  const handleChangeQty = useCallback(
    (id: number, qty: number) => runEdit(id, () => onUpdateIntakeQty(id, qty)),
    [runEdit, onUpdateIntakeQty],
  )

  const handleChangeDetail = useCallback(
    (id: number, patch: IntakeDetailPatch) => runEdit(id, () => onUpdateIntakeDetail(id, patch)),
    [runEdit, onUpdateIntakeDetail],
  )

  /* 改餐別成功後收合編輯區。**原本寫「讓 FLIP layout 動畫帶著它移動、使用者看得到去向」
     是錯的宣稱**：那一筆會進到另一個 MealNode 的 <ul>，React 只能卸載舊實例＋掛載新實例，
     裸 `layout` 跨不過去（能跨的只有 `layoutId`）。實測蓋章追蹤：+80ms 時同一筆同時存在
     兩份、來源餐別標題顯示「午餐 0」，+160ms 舊的消失、新的憑空出現（`initial={false}`
     連進場都沒有）。所以「看得到去向」要靠別的機制——成功後把新位置捲進視野並把焦點帶
     過去，這在真實密度（一餐 3–5 筆、時間軸可視高度只剩約 430px）下更重要：目的地餐別
     多半根本不在畫面上，不捲的話那一筆就是「消失」。 */
  const handleChangeMeal = useCallback(
    async (id: number, meal: MealKey) => {
      await runEdit(id, () => onUpdateIntakeMeal(id, meal))
      setActive((prev) => (prev?.id === id ? null : prev))
      // 等 React 把它掛到新的餐別區段之後才找得到節點
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-row="${id}"]`)
        el?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' })
        el?.querySelector<HTMLButtonElement>('.item-content')?.focus({ preventScroll: true })
      })
    },
    [runEdit, onUpdateIntakeMeal],
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
          /* 蛋白質永遠不轉破表（v2.20 訂正，使用者裁決）。DESIGN.md 的「三大營養素判定」
             一直只列舉脂肪與碳水，LogSheet 的逐筆預警條也明講「不含蛋白質——它的語意是
             『達標』不是『超標』」，但這裡的實作對三項一視同仁，於是減脂使用者好不容易
             把蛋白質吃到 136.5/126，畫面回他一條紅色斜紋警告。同一份 DESIGN.md 拒絕做
             綠色達標的理由是「六天資料從沒達標過」，現在達標了卻被當成錯誤，方向剛好相反。
             （hallmark 視覺稽核抓到，屬既有 bug 不是本輪引入。） */
          const macroOver = key !== 'protein' && cur !== null && macroExceeds(cur, target)
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
                /* 「超出目標 126 克」會被讀成「超出了 126 克」，但 126 是目標值本身。
                   拆成兩個子句消歧義（v2.20，同樣的寫法要記得同步 LogSheet 的 macro-line）。 */
                aria-label={cur === null ? undefined : `${MACRO_LABEL[key]} ${curTxt} 克，${macroOver ? '已超出，目標' : '目標'} ${tgtTxt} 克`}
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
            active,
            justAddedIds,
            onOpenSheet,
            toggleEdit,
            setSwipe,
            closeActive,
            handleDelete,
            handleChangeQty,
            handleChangeMeal,
            handleChangeDetail,
            editErr,
          })
        )}
      </div>
    </div>
  )
}

interface TimelineHelpers {
  active: { id: number; mode: 'swipe' | 'edit' } | null
  justAddedIds: ReadonlySet<number>
  onOpenSheet: (meal: MealKey) => void
  toggleEdit: (id: number) => void
  setSwipe: (id: number, open: boolean) => void
  closeActive: () => void
  handleDelete: (id: number) => void
  handleChangeQty: (id: number, qty: number) => Promise<void>
  handleChangeMeal: (id: number, meal: MealKey) => Promise<void>
  handleChangeDetail: (id: number, patch: IntakeDetailPatch) => Promise<void>
  editErr: { id: number; msg: string } | null
}

/* 一列品項。位移層是 motion.div（純 transform，不動 layout），刪除鈕壓在它底下，
   滑開才露出來——這是「覆蓋式」的反面做法：實際上是內容讓開，不是鈕蓋上去，
   但視覺結果一樣而且不必在鈕上做位移動畫。開合狀態由父層的 active 單一決定，
   `animate` 負責放手後吸附到位，拖曳中則由 drag 手勢直接接管 x。

   **v2.20：品名列與刪除鈕包進 `.item-main`，展開的編輯區是它的兄弟**。刪除鈕靠
   `position:absolute` ＋ `top:0;bottom:0;margin:auto 0` 垂直置中，定位基準若還是整個
   `.item-row`，編輯區一展開它就會掉到「品名列＋編輯區」的正中間去（實際上會落在
   分段控制器那一行）。多包這一層，紅圓永遠只以品名列為基準。 */
function SwipeRow({
  row,
  name,
  vendor,
  qty,
  open,
  editing,
  justAdded,
  onTap,
  onSwipeTo,
  onCollapse,
  onDelete,
  onQty,
  onMeal,
  onDetail,
  err,
}: {
  row: IntakeRow
  name: string
  vendor: string | null
  qty: number
  open: boolean
  editing: boolean
  justAdded: boolean
  onTap: () => void
  onSwipeTo: (next: boolean) => void
  onCollapse: () => void
  onDelete: () => void
  onQty: (qty: number) => Promise<void>
  onMeal: (meal: MealKey) => Promise<void>
  onDetail: (patch: IntakeDetailPatch) => Promise<void>
  err: string | null
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLButtonElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
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
    onSwipeTo(moved < -OPEN_AT || flung)
  }

  const editorId = `item-editor-${row.id}`

  return (
    /* Escape 掛在 .item-row 這一層，不掛在編輯區上：展開後焦點停在 .item-content，
       它是編輯區的**兄弟**不是祖先，事件只往上冒泡不會橫向傳——掛在編輯區時「展開後
       直接按 Esc」完全沒反應，得先 Tab 進 stepper 才有效（impeccable 抓到，實測確認）。 */
    <div
      className={`item-row${open ? ' is-open' : ''}${editing ? ' is-edit' : ''}${armed ? ' is-armed' : ''}`}
      onKeyDown={(e) => {
        if (editing && e.key === 'Escape') {
          e.stopPropagation()
          onCollapse()
        }
      }}
    >
      <div className="item-main" ref={rowRef}>
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
            // 編輯區不在 .item-slide 裡（它不跟著位移），拖曳中留著會變成「上半條在動、
            // 下面那塊釘住不動」，所以一判定成拖曳就收合
            if (editing) onCollapse()
          }}
          onDrag={() => setArmed(x.get() < -fullSwipeAt())}
          onDragEnd={handleDragEnd}
        >
          <button
            ref={contentRef}
            className={`item-content${justAdded ? ' just-added' : ''}`}
            type="button"
            aria-expanded={editing}
            aria-controls={editing ? editorId : undefined}
            onClick={() => {
              // 拖曳期間／剛結束時瀏覽器補的那個 click 吃掉，免得滑開的同時又展開編輯區
              if (Date.now() < blockClickUntil.current) return
              onTap()
            }}
          >
            {/* ×N 必須在會 ellipsis 的 .nm **外面**：它原本是 .nm 的最後一個子節點，
                長品名（真實資料常態是「雞胸餐盒 大心」這種帶店家的）一截斷，第一個被吃掉
                的就是份量標記——正好是這輪核心功能唯一的畫面回饋。照 .kc 的做法給
                flex-shrink:0 保護（hallmark 抓到；v2.19 才剛為了同一個抱怨把 .qty 改成
                --ink 加粗，長品名上等於原封不動地回來）。 */}
            <span className="nm-wrap">
              <span className="nm">
                {name}
                {vendor && <span className="vendor"> {vendor}</span>}
              </span>
              {qty !== 1 && <span className="qty">×{qty}</span>}
            </span>
            <span className="kc">{Math.round(num(row.kcal) * qty)}</span>
          </button>
        </motion.div>
      </div>
      {/* height auto 是這裡唯一動 layout 屬性的地方（DESIGN.md 的「只動 transform／
          opacity」是為了列表重排的效能，展開一列不是重排）。overflow:hidden 掛在
          motion.div 自己身上，不靠 .item-row 的 overflow:clip——後者是為了裁掉左滑
          時的水平溢位，兩件事不該互相牽制。 */}
      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            key="editor"
            ref={editorRef}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={quick ? { duration: 0 } : { duration: sec(DUR.mid), ease: EASE }}
            style={{ overflow: 'hidden' }}
            /* 展開最後一列時整塊會被底部列擋住。等動畫跑完才滾——展開途中高度還在
               0→auto 的路上，那時算出來的可見範圍是錯的。`height === 'auto'` 用來
               區分展開與收合兩個方向（收合時 definition 是 exit 那組，不該滾）。 */
            onAnimationComplete={(def) => {
              if ((def as { height?: unknown })?.height !== 'auto') return
              editorRef.current?.scrollIntoView({ block: 'nearest', behavior: quick ? 'auto' : 'smooth' })
            }}
          >
            <ItemEditor
              id={editorId}
              row={row}
              name={name}
              qty={qty}
              openerRef={contentRef}
              onQty={onQty}
              onMeal={onMeal}
              onDetail={onDetail}
              onDelete={onDelete}
              err={err}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* 就地編輯區（v2.20，取代 v2.14 的長按 sheet）。兩排都是 --r-tab 的分段家族：
   上排 qty stepper ＋ 刪除，下排餐別分段控制器。刪除鈕用負 margin 懸出容器的水平
   內距，讓圖示與上一行的熱量數字落在同一條垂直線上——帶框的 stepper／分段器需要
   內距才不會貼壁，無框的圖示不需要，兩者的對齊基準本來就不同。 */
function ItemEditor({
  id,
  row,
  name,
  qty,
  openerRef,
  onQty,
  onMeal,
  onDetail,
  onDelete,
  err,
}: {
  id: string
  row: IntakeRow
  name: string
  qty: number
  openerRef: React.RefObject<HTMLButtonElement | null>
  onQty: (qty: number) => Promise<void>
  onMeal: (meal: MealKey) => Promise<void>
  onDetail: (patch: IntakeDetailPatch) => Promise<void>
  onDelete: () => void
  err: string | null
}) {
  const [localQty, setLocalQty] = useState(qty)
  const [draft, setDraft] = useState(String(qty))
  /* 餐別也走樂觀：按下當場就渲染成選中，不等往返。原本 aria-current 綁 row.meal（伺服器
     真值）＋ disabled 只改 cursor，於是慢網路下按「晚餐」畫面上一個 pixel 都不會變，
     使用者會重按（hallmark 與 impeccable 兩個獨立 reviewer 撞在同一條）。專案在隔壁對
     同一情境已有相反裁決：.item-delete:disabled 設 opacity .6，註解寫「破壞性動作＋慢網路，
     按下去毫無變化的話很容易再按第二次」。 */
  const [localMeal, setLocalMeal] = useState<MealKey>(row.meal as MealKey)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')

  /* 收合時把焦點還給品名列。**但只在焦點還在編輯區裡時才搶**，而且 preventScroll——
     這個 cleanup 會在每一條收合路徑上跑（點別列、開始拖曳、Escape、刪除），無條件
     focus() 會順帶把視窗捲回剛離開的那一列：往下捲到第 5 列點它 → 第 1 列的編輯區卸載
     → 捲動跳回第 1 列 → 第 5 列的 onAnimationComplete 再捲一次，一次點擊兩段互打的捲動
     （impeccable 抓到）。改餐別那條路徑由 handleChangeMeal 自己把焦點送到新位置，
     這裡不插手。 */
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(
    () => () => {
      if (rootRef.current?.contains(document.activeElement)) {
        openerRef.current?.focus({ preventScroll: true })
      }
    },
    [openerRef],
  )

  /* ponytail: 每按一次 +／− 就直接送一次 PATCH，不做 debounce。連按會送出多個請求，
     但每個都是「完整覆寫 qty」而不是增量，同一條連線下到達順序即發送順序，最後一次
     獲勝。升級路徑：真的遇到畫面與 DB 對不上，再加 300ms debounce ＋ 收合時 flush——
     那需要多一組 timer 生命週期，而這個元件已經在 timer 清理上翻船過兩次（長按計時器
     沒隨 unmount 清、sheet 關閉計時器），先不引入第三組。 */
  async function commitQty(next: number) {
    const prevQty = localQty
    const prevDraft = draft
    setLocalQty(next)
    setDraft(String(next))
    try {
      await onQty(next)
      setSaid(`份量已改為 ${next}`)
    } catch {
      setLocalQty(prevQty)
      setDraft(prevDraft)
      // 訊息由 Today 層的 editErr 供應（它活得比這個元件久），這裡只負責回滾自己的值
    }
  }

  // 打字途中不正規化，理由與 LogSheet 的 handleQtyInput 相同：中間態被改掉游標會跳走
  function handleInput(raw: string) {
    setDraft(raw)
    const n = Number(raw.trim())
    if (Number.isFinite(n) && n > 0) setLocalQty(n)
  }

  /* 品名與四個營養數字：**改的是這一筆，不是食品庫**（去皮、少醬、店家給多了）。
     每欄 blur 時各自 commit 一次、只送有變的那一欄，與 qty 的 onBlur 同一套慣例——
     不做「儲存」按鈕，編輯區沒有送出的概念，每個動作都是即時的。
     草稿初始值用**有效品名**（可能來自 foods），所以「打開沒改就關掉」要靠下面那個
     相等比對擋掉，否則會把 foods 的品名白白複製進 name 快照欄、無謂地讓它脫鉤。 */
  const [detail, setDetail] = useState({
    name,
    kcal: String(num(row.kcal)),
    protein: String(num(row.protein)),
    fat: String(num(row.fat)),
    carb: String(num(row.carb)),
  })

  async function commitName(raw: string) {
    const next = raw.trim() || null
    if (next === (row.name ?? name)) return
    try {
      await onDetail({ name: next })
      setSaid(next ? `品名已改為 ${next}` : `品名已還原成食品庫的 ${name}`)
    } catch {
      setDetail((d) => ({ ...d, name }))
    }
  }

  /* 本地驗證失敗（空白、負數、打錯字）**不走「存不進去」那條錯誤訊息**——那句是 PATCH
     失敗專用的，借來說「你打錯了」會讓兩種完全不同的狀況長得一樣。改成當場還原該欄並
     用既有的 sr-only 播報說明，視覺上使用者也看得到值跳回去了。 */
  async function commitMacro(key: DetailKey, raw: string) {
    const prev = num(row[key])
    const trimmed = raw.trim()
    const n = Number(trimmed)
    /* 空字串要自己擋：`Number('')` 是 0 而不是 NaN，少了這半清空欄位會被當成
       「我今天吃的這份脂肪是 0」靜靜存進去，而且畫面上那格還是留白的（e2e 抓到）。
       想歸零的人打得出 0，清空從來不是那個意思。 */
    if (!trimmed || !Number.isFinite(n) || n < 0) {
      setDetail((d) => ({ ...d, [key]: String(prev) }))
      setSaid(`${DETAIL_LABEL[key]} 要填 0 或正數，已還原`)
      return
    }
    if (n === prev) return
    try {
      await onDetail({ [key]: n })
      setSaid(`${DETAIL_LABEL[key]} 已改為 ${n}`)
    } catch {
      setDetail((d) => ({ ...d, [key]: String(prev) }))
    }
  }

  const macroField = (key: DetailKey) => (
    <div className="field-float">
      <input
        id={`${id}-${key}`}
        type="text"
        inputMode="decimal"
        placeholder=" "
        value={detail[key]}
        onChange={(e) => setDetail((d) => ({ ...d, [key]: e.target.value }))}
        onBlur={(e) => void commitMacro(key, e.target.value)}
      />
      <label htmlFor={`${id}-${key}`}>{DETAIL_LABEL[key]}</label>
    </div>
  )

  async function pickMeal(key: MealKey) {
    if (key === localMeal || busy) return
    const prev = localMeal
    setLocalMeal(key)
    setBusy(true)
    try {
      await onMeal(key)
      // 成功後這個元件會被收合卸載，setState 不會有機會跑到；失敗才走下面
    } catch {
      setLocalMeal(prev)
      setBusy(false)
    }
  }

  return (
    <div className="item-editor" id={id} ref={rootRef} role="group" aria-label={`編輯 ${name}`}>
      <div className="ed-line">
        <div className="qty-stepper">
          <button
            className="qty-btn"
            type="button"
            disabled={localQty <= 1}
            aria-label="減少份量"
            onClick={() => void commitQty(normalizeQty(localQty - 1))}
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
            value={draft}
            onChange={(e) => handleInput(e.target.value)}
            onBlur={(e) => void commitQty(normalizeQty(e.target.value))}
          />
          <button
            className="qty-btn"
            type="button"
            aria-label="增加份量"
            onClick={() => void commitQty(normalizeQty(localQty + 1))}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <button className="ed-del" type="button" aria-label={`刪除 ${name} 這一筆`} onClick={onDelete}>
          <DeleteIcon />
        </button>
      </div>
      <div className="ed-line">
        {/* 餐別是互斥的四選一，用分段控制器而不是記一筆 sheet 那排可捲動的 pill chip。
            **選中態用 aria-pressed，不用 aria-current**：後者的規範語意是「目前所在的
            頁面／步驟／位置」，用在一個按下去會改變資料值的控制項上是誤用（a11y 稽核
            抓到；LogSheet 既有的同款 chip 也有一樣的問題，範圍外，記進待決）。
            沒有升級成 radiogroup 是刻意的取捨：APG 的 radiogroup 契約要 roving tabindex
            ＋方向鍵導航，半套實作會讓螢幕閱讀器期待方向鍵可用卻沒有，比不做更糟。
            另配字重 600 當非顏色訊號——--accent-soft 對 --card 只有 1.22:1。
            **不用原生 disabled 擋重入**：那會讓正被按下、正持有焦點的那顆瞬間失焦，
            失敗時焦點就掉到 body 再也回不來（a11y 稽核抓到）；改用 busy 邏輯守衛。 */}
        <div className="seg" role="group" aria-label="餐別">
          {MEALS.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={m.key === localMeal}
              onClick={() => void pickMeal(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {/* 品名與營養值。欄位版型照新增食物表單（DESIGN.md「新增食物表單欄位」）：品名整行、
          熱量整行、三大營養素三欄並排——同一組數字在兩個地方長得一樣，使用者不必重學。
          **這裡沒有店家欄**：店家是食品庫的屬性，「今天這份去了皮」不會換一家店。 */}
      <div className="ed-line ed-detail">
        <div className="field-float">
          <input
            id={`${id}-name`}
            type="text"
            placeholder=" "
            value={detail.name}
            onChange={(e) => setDetail((d) => ({ ...d, name: e.target.value }))}
            onBlur={(e) => void commitName(e.target.value)}
          />
          <label htmlFor={`${id}-name`}>品名</label>
        </div>
        {macroField('kcal')}
        <div className="field-row">
          {macroField('protein')}
          {macroField('fat')}
          {macroField('carb')}
        </div>
      </div>
      {err && (
        <p className="sheet-error ed-error" role="alert">
          存不進去：{err}
        </p>
      )}
      {/* 改份量／改餐別成功後畫面只有數字變動，螢幕閱讀器聽不到任何確認（WCAG 4.1.3）。
          改餐別的播報由 handleChangeMeal 把焦點送到新位置代勞（VoiceOver 會唸出整列），
          這裡負責份量。 */}
      <span className="sr-only" role="status" aria-live="polite">
        {said}
      </span>
    </div>
  )
}

function renderTimeline(rows: IntakeRow[], date: string, h: TimelineHelpers) {
  const byMeal = new Map<MealKey, IntakeRow[]>(MEALS.map((m) => [m.key, []]))
  for (const r of rows) byMeal.get(r.meal as MealKey)?.push(r)

  /* 三筆完全同名的「雞胸餐盒」只靠店家區分。今日頁常態不顯示店家，
     同一天出現兩筆同名時才非顯示不可，否則回頭核對或刪除都是盲的。
     **數的是有效品名**（改過名的那筆算它自己的新名字）——不然「雞排便當」與
     「雞排便當（去皮）」會被當成兩筆同名而雙雙掛上店家。 */
  const nameCount = new Map<string, number>()
  for (const r of rows) {
    const n = r.name ?? r.foods?.name
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
                  /* intake 自己的品名快照優先於 foods 的：改過名的那筆從此與食品庫脫鉤，
                     食品庫日後改品名不回頭改寫它（與 kcal/protein/fat/carb 同一套語意）。 */
                  const name = r.name ?? r.foods?.name ?? '（食物已刪除）'
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
                        key={r.id}
                        row={r}
                        name={name}
                        vendor={dup}
                        qty={num(r.qty)}
                        open={h.active?.id === r.id && h.active.mode === 'swipe'}
                        editing={h.active?.id === r.id && h.active.mode === 'edit'}
                        justAdded={h.justAddedIds.has(r.id)}
                        onTap={() => h.toggleEdit(r.id)}
                        onSwipeTo={(next) => h.setSwipe(r.id, next)}
                        onCollapse={h.closeActive}
                        onDelete={() => h.handleDelete(r.id)}
                        onQty={(q) => h.handleChangeQty(r.id, q)}
                        onMeal={(m) => h.handleChangeMeal(r.id, m)}
                        onDetail={(p) => h.handleChangeDetail(r.id, p)}
                        err={h.editErr?.id === r.id ? h.editErr.msg : null}
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
