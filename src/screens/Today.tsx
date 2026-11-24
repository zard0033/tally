/* 今日頁：熱量量尺＋三大營養素條＋餐別時間軸＋左滑刪除。
   行為與視覺對齊 DESIGN.md v2.1：日期區「週二 7/28」＋回今天安靜文字鈕；
   左滑刪除自 v2.1 改用 motion drag 手刻（取代 react-swipeable-list——那個套件拖曳中
   每一幀改 trailing actions 的 width，等於每幀觸發版面重排，真機體感與 iOS 有明顯落差；
   motion 這條是純 transform，走合成層）。計算全部交給 src/lib/formulas.ts。 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, type PanInfo } from 'motion/react'
import type { IntakeDetailPatch, IntakeRow } from '@/lib/api'
import CategoryIcon, { CategoryStack } from '@/components/CategoryIcon'
import DateStrip from '@/components/DateStrip'
import { useCountUp } from '@/components/useCountUp'
import { Skel, SkelBlock } from '@/components/Skeleton'
import { useSkyEdge } from '@/components/useSkyEdge'
import { DeleteIcon } from '@/components/DeleteIcon'
import { iconStack, leadCategory } from '@/lib/categories'
import { isPlannable, localDate, weekdayDate } from '@/lib/dates'
import { errMsg, friendlyError } from '@/lib/errors'
import { DUR, EASE, sec, SETTLE_SPRING } from '@/lib/durations'
import { CLICK_GRACE_MS, clampReleaseVelocity, shouldOpenSwipe } from '@/lib/swipePhysics'
import { macroExceeds, macroGap, num, pct, sumIntake } from '@/lib/formulas'
import { MEALS, type Meal, type MealKey } from '@/lib/meals'
import { suffixOf, type Macros, type ModTarget } from '@/lib/portionMods'
import { suggestLabel, type RepeatByMeal, type RepeatSuggestion, type SuggestSource } from '@/lib/mealSuggest'
import { rowVendor } from '@/lib/mealVendor'
import { askSkip, isMainMeal, msToNextAskBoundary, type MainMeal } from '@/lib/weekBudget'
import ItemEditor from './ItemEditor'
import TodayScene from './TodayScene'
import WeekCard from './WeekCard'
import type { TodayProps } from './types'

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const MACRO_LABEL: Record<'protein' | 'fat' | 'carb', string> = { protein: '蛋白質', fat: '脂肪', carb: '碳水' }

/* 左滑的距離（放手是否開啟的判定在 lib/swipePhysics）。REVEAL＝44px 圓鈕＋兩側留白，就是「開啟」時停下來的位置；
   FULL_AT＝拖過列寬這個比例放手，直接刪除（iOS 提醒事項的滑到底行為，配 undo 才安全）。 */
const REVEAL = 56
const FULL_AT = 0.45

/* v2.20：編輯份量從「長按開全屏 sheet」改成「點按就地展開」，長按整套（500ms 計時器、
   位移備援門檻、與 drag 手勢的互相取消、開合／退場動畫的 token 讀取）連同 sheet 一起移除。
   拆掉的理由不只是版面——長按與 drag="x" 共用同一次 pointerdown，兩套手勢的仲裁是這個
   元件翻船最多次的地方（誤閃 reveal 修了兩輪仍在真機上重現）。點按走的是原生 click，
   沒有仲裁問題。左滑刪除那組手勢（REVEAL/OPEN_AT/FULL_AT）完全不動。 */

export default function Today(props: TodayProps) {
  const {
    dayData,
    targets,
    currentDate,
    markedDates,
    onGoToDate,
    onViewMonth,
    onOpenSheet,
    onDeleteIntake,
    justAddedIds,
    lastAddedIds,
    onUpdateIntakeQty,
    onUpdateIntakeMeal,
    onUpdateIntakeDetail,
    foodById,
    repeatByMeal,
    repeatBusyKey,
    repeatErr,
    onAddRepeat,
    onSwapRepeat,
    week,
    weekBmr,
    onWeekRetry,
    skipsOf,
    onSetSkip,
  } = props

  /* 份量微調的基準：食品庫現在那一筆（spec「份量微調」：之後再改用現在的數字重算）。封存或刪掉的查不到就不出微調。 */
  const modBaseOf = (r: IntakeRow): { target: ModTarget; base: Macros } | null => {
    const f = foodById(r.food_id)
    if (!f) return null
    return { target: { name: f.name, category: f.category }, base: { kcal: num(f.kcal), protein: num(f.protein), fat: num(f.fat), carb: num(f.carb) } }
  }

  const rows = dayData.rows
  /* v2.47：主數字的語意分岔點從「是不是今天」改成**「是不是過去」**。
     回頭看過去問的是「那天吃了多少」（顯示攝取量）；今天與明天問的都是「還剩多少／超了多少」
     ——明天那頁存在的理由就是這個數字，它跟今天是同一個問題，只是還沒發生。
     **判斷用 dates.ts 的共用函式**：記一筆 sheet 的確認列問的是同一件事，第一版兩處各算
     一份、只改了這裡，結果明天的確認列退化成「共 N」（deep review 抓到）。 */
  const isPast = !isPlannable(currentDate)

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
      setEditErr({ id, msg: friendlyError(errMsg(e)) })
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

  const edge = useSkyEdge()

  /* 「沒吃／補記」與這週卡看現在幾點、今天是哪天：在下一個 11 點、15 點或午夜重畫一次（review N4），
     一直開著也會在時段過了的當下冒出來，不必等使用者切日期。同時只有一個計時器，卸載就清掉。 */
  const [clockTick, setClockTick] = useState(0)
  useEffect(() => {
    const t = window.setTimeout(() => setClockTick((n) => n + 1), msToNextAskBoundary(new Date()) + 50)
    return () => window.clearTimeout(t)
  }, [clockTick])
  const nowDay = localDate()
  const nowHour = new Date().getHours()

  /* 記完一餐的那句話（訓練分頁改版 D2-b，使用者 2026-11-23 選）：某一餐從「沒記」變成「記了」的那一下（只看剛加入的那幾筆，
     載入、換日期、編輯都不算），頂端浮出「晚餐記好了 · 還能吃 420 卡」約 2 秒；今天的早、午、晚三餐因此都記了（點心不算必要），
     改成「三餐都記了 · 這個月記了 N 天」。慶祝的是「有記」：超出時只說記好了，不講吃了多少；沒有綠色、不提連續天數（斷了會變壓力）。
     放頂端不放底部：底部是刪除與一鍵加入的復原條，兩條會疊在一起。 */
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  // 加入的 id 先到、重撈的 rows 後到：等 rows 裡真的有這幾筆才判斷，同一批只判一次。
  // 「上一批」記在 state（React 的「記住上一次的值」寫法），render 被重跑也不會吞掉提示
  const [seenAdded, setSeenAdded] = useState(lastAddedIds)
  if (lastAddedIds !== seenAdded && lastAddedIds.size > 0 && rows?.some((r) => lastAddedIds.has(r.id))) {
    setSeenAdded(lastAddedIds)
    const newly = MEALS.filter((m) => {
      const rs = rows.filter((r) => r.meal === m.key)
      return rs.length > 0 && rs.every((r) => lastAddedIds.has(r.id))
    })
    if (newly.length > 0) {
      const logged = new Set(rows.map((r) => r.meal))
      const today = localDate()
      const mains: MealKey[] = ['breakfast', 'lunch', 'dinner']
      const dayDone = currentDate === today && mains.every((k) => logged.has(k)) && newly.some((m) => mains.includes(m.key))
      let text: string
      if (dayDone) {
        const month = today.slice(0, 7)
        const days = new Set([...markedDates].filter((d) => d.startsWith(month) && d <= today))
        days.add(today)
        text = `三餐都記了 · 這個月記了 ${days.size} 天`
      } else {
        const left = eatenKcal === null || isPast || over ? null : targetKcal - eatenKcal
        text = `${newly[newly.length - 1].label}記好了${left !== null ? ` · 還能吃 ${left} 卡` : ''}`
      }
      setToast({ seq: (toast?.seq ?? 0) + 1, text })
    }
  }
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), LOG_TOAST_MS)
    return () => window.clearTimeout(t)
  }, [toast])

  return (
    <div className={`main${over ? ' is-over' : ''}`} data-screen="today">
      <div className="log-toast-wrap" role="status" aria-live="polite">
        {toast && (
          <div key={toast.seq} className="log-toast" data-testid="log-toast" style={{ '--log-toast-ms': `${LOG_TOAST_MS}ms` } as CSSProperties}>
            {toast.text}
          </div>
        )}
      </div>
      {/* v2.122：天空與三大營養素跟著時間軸一起捲（.timeline 是整頁唯一的捲動區）。插圖把頂端撐高了約 70px，
          固定不動的話 393×745 下時間軸只剩不到 300px，展開最後一列的編輯區（約 322px）整塊放不進去。 */}
      <div className="timeline" ref={edge.ref} onScroll={edge.sync}>
        {/* v2.122：日期元件與「還能吃」坐在插圖的天空上。插圖在最底層、絕對定位，跟著這一塊的高度走——
            月曆展開時天空往上長，山坡永遠貼在最下面。 */}
        <div className="sky">
          <TodayScene key={currentDate} date={currentDate} logged={rows && new Set(rows.map((r) => r.meal))} onPick={onOpenSheet} />
          {/* v2.53：日期元件從 v2.4 的 `‹ 日期 ›` 膠囊換成週列＋月曆（src/components/DateStrip.tsx；
              決策與被推翻的舊決定見 DESIGN.md「日期切換」）。h1 在元件裡面。 */}
          <header className="topbar">
            <DateStrip date={currentDate} marked={markedDates} onSelect={onGoToDate} onViewMonth={onViewMonth} />
          </header>

          {/* 補遺①：這個 aria-label 原本寫死「今日熱量」，**在歷史日就已經是錯的**（不是這輪引入，
              但這輪明知就不能照抄）。改成跟著檢視日走，讀屏使用者才知道自己在看哪一天。 */}
          <section className="gauge" aria-label={`${weekdayDate(currentDate)} 熱量`}>
            <div className="gauge-top">
              <div>
                <div className="gauge-lead">{eatenKcal === null ? '還能吃' : isPast ? '攝取' : over ? '超出' : '還能吃'}</div>
                <div aria-live="polite">
                  <span className="gauge-num">
                    {eatenKcal === null ? '—' : isPast ? eatenKcal : Math.abs(targetKcal - eatenKcal)}
                  </span>
                  <span className="gauge-unit">卡</span>
                </div>
              </div>
            </div>
            {/* 量尺縮成大數字底下的一小段，數對接在右邊：「還能吃」才是主角，這兩個是它的出處 */}
            <div className="gauge-meta">
              <div className="bar" aria-hidden="true">
                <div className="fill" style={{ width: `${eaten ? pct(eaten.kcal, targets.kcal) : 0}%` }} />
              </div>
              <div
                className="gauge-side pair"
                role="group"
                aria-label={eatenKcal === null ? undefined : `已攝取 ${eatenKcal} 大卡，目標 ${targetKcal} 大卡`}
              >
                <span aria-hidden="true">
                  <span className="cur">{eatenKcal ?? '—'}</span>
                  <span className="sep">/</span>
                  <span className="tgt">{targetKcal}</span>
                </span>
              </div>
            </div>
          </section>
        </div>

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
            // 歷史日不顯示：缺口問的是「還能補多少」，過去的日子沒有這個問題
            const gap = isPast || cur === null ? null : macroGap(cur, target)
            return (
              <div className={`macro${macroOver ? ' over' : ''}${key === 'protein' ? ' is-protein' : ''}`} key={key}>
                <div className="lbl">{MACRO_LABEL[key]}</div>
                <div className="track-box" aria-hidden="true">
                  <div className="track">
                    <div className="fill" style={{ width: `${cur === null ? 0 : pct(cur, target)}%` }} />
                  </div>
                </div>
                <div
                  className="val pair"
                  role="group"
                  /* 「超出目標 126 克」會被讀成「超出了 126 克」，但 126 是目標值本身。
                     拆成兩個子句消歧義（v2.20，同樣的寫法要記得同步 LogSheet 的 macro-line）。 */
                  aria-label={cur === null ? undefined : `${MACRO_LABEL[key]} ${curTxt} 克，${macroOver ? '已超出，目標' : '目標'} ${tgtTxt} 克${gap === null ? '' : `，還差 ${gap} 克`}`}
                >
                  <span aria-hidden="true">
                    <span className="cur">{curTxt}</span>
                    <span className="sep">/</span>
                    <span className="tgt">{tgtTxt}</span>
                    {gap !== null && <span className="gap">差 {gap}</span>}
                  </span>
                </div>
              </div>
            )
          })}
        </section>

        {/* 這週（v2.165）：放在今天的三大營養素之後、時間軸之前——大數字與三大是「今天」，卡片是「這週」，
            不插進兩者中間（樣張沒有三大這一列）。 */}
        <WeekCard data={week} today={nowDay} target={targets.kcal} bmr={weekBmr} onRetry={onWeekRetry} onGoToDate={onGoToDate} />

        <div className="meals">
          {rows === null ? (
            /* 四列餐別骨架，列高同 .todo-row（44px）。讀屏與 e2e 讀隱藏的「載入中…」 */
            <SkelBlock>
              {['3em', '3em', '2.2em', '3em'].map((w, i) => (
                <div key={i} className="skel-row"><Skel w={w} h="16px" /><Skel w="2.6em" /></div>
              ))}
            </SkelBlock>
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
              modBaseOf,
              editErr,
              repeatByMeal,
              onAddRepeat,
              onSwapRepeat,
              repeatBusyKey,
              repeatErr,
              skips: skipsOf(currentDate),
              onSetSkip: (meal, on) => onSetSkip(currentDate, meal, on),
              today: nowDay,
              hour: nowHour,
              skipsReady: week.state === 'done',
            })
          )}
        </div>
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
  modBaseOf: (r: IntakeRow) => { target: ModTarget; base: Macros } | null
  editErr: { id: number; msg: string } | null
  repeatByMeal: RepeatByMeal
  onAddRepeat: (date: string, s: RepeatSuggestion) => void
  onSwapRepeat: (meal: MealKey) => void
  repeatBusyKey: string | null
  repeatErr: { key: string; msg: string } | null
  /** 這一天按過「沒吃」的餐。 */
  skips: ReadonlySet<MainMeal>
  onSetSkip: (meal: MainMeal, on: boolean) => Promise<void>
  today: string
  hour: number
  skipsReady: boolean
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
  suffix,
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
  modBase,
}: {
  row: IntakeRow
  name: string
  /** 份量微調的後綴（中杯・微糖）；只接在顯示上，不進就地編輯的品名欄（否則沒改就關會把後綴存成品名）。 */
  suffix: string
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
  modBase: { target: ModTarget; base: Macros } | null
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

  /* 放手瞬間的橫向速度，交棒給吸附用的 spring（v2.38）。**motion 不會自己交棒**——
     實測（e2e 探針，慢拖 vs 快甩同樣放手在 -90）兩者過衝都是 0，spring 一律從靜止起跑。
     `dragMomentum={false}` 關掉的是 motion 自己那套慣性滑行，連帶也沒有把速度傳下去，
     所以要自己記一份餵給 transition 的 `velocity`。
     **夾上限**：對照 demo 實測不夾的話用力一甩會衝出去兩三百 px 再彈回來，那不是 iOS
     手感是失控；1500 px/s 已經比真人甩得動的還快。 */
  const releaseVel = useRef(0)

  function handleDragEnd(_e: unknown, info: PanInfo) {
    setArmed(false)
    blockClickUntil.current = Date.now() + CLICK_GRACE_MS
    releaseVel.current = clampReleaseVelocity(info.velocity.x)
    const moved = x.get()
    // 拖過列寬 45% 放手＝直接刪除（有 undo 兜底，見 App.tsx 的 pendingDelete）
    if (moved < -fullSwipeAt()) {
      onDelete()
      return
    }
    const next = shouldOpenSwipe(moved, info.velocity.x)
    onSwipeTo(next)
    /* `animate` prop 只在 `open` 真的變了才會重跑：列開著又往左多拉，沒有東西把它吸回去，
       就停在拖到的位置（SwipeDelete 修過同一個真機 bug，那邊有完整說明）。 */
    if (next === open) {
      const target = next ? -REVEAL : 0
      if (quick) x.jump(target)
      else animate(x, target, { ...SETTLE_SPRING, velocity: 0 })
    }
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
          /* v2.38：吸附改 spring 並手動交棒放手速度（見上方 releaseVel 與 durations.ts）。
             **速度只在「往左開啟」那個方向交棒，收合一律從靜止起跑**（`open ? ... : 0`）。
             收合那半刻意不吃 velocity，是因為 `onAnimationComplete` 靠不住：**動畫被打斷時
             motion 不會呼叫它**（`JSAnimation.stop()` 只發 onStop），而 transition 物件是
             render 當下就把 ref 的值烘進去的。於是「用力甩開 A 列 → 開啟動畫還沒跑完就去點
             B 列」會讓 A 的**被動收合**帶著 A 剛才那一甩的殘留速度，往開的方向先衝約 16px
             再關回去——方向與動作相反（precommit review 抓到，已對 motion 原始碼證實）。
             歸零仍留著當第二道保險，但正確性不靠它。
             代價：手勢往右甩關閉不再承接速度。可接受——`dragConstraints.right` 與
             `dragElastic.right` 都是 0，那個方向本來就沒有多少動態可承接。 */
          transition={quick ? { duration: 0 } : { ...SETTLE_SPRING, velocity: open ? releaseVel.current : 0 }}
          onAnimationComplete={() => { releaseVel.current = 0 }}
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
            {/* 店家在品名下一行（spec「每一餐記店家」T-A）：有店家的列都寫，通用食物寫這一餐記的那家 */}
            <span className="nm-col">
              <span className="nm-wrap">
                <span className="nm">
                  {name}
                  {suffix}
                </span>
                {qty !== 1 && <span className="qty">×{qty}</span>}
              </span>
              {vendor && <span className="vendor">{vendor}</span>}
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
              modBase={modBase}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function renderTimeline(rows: IntakeRow[], date: string, h: TimelineHelpers) {
  const byMeal = new Map<MealKey, IntakeRow[]>(MEALS.map((m) => [m.key, []]))
  for (const r of rows) byMeal.get(r.meal)?.push(r)

  return (
    <>
      {MEALS.map((meal) => {
        const items = byMeal.get(meal.key) ?? []
        return (
          <MealNode
            key={`${meal.key}-${date}`}
            meal={meal}
            date={date}
            items={items}
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
  date,
  items,
  h,
}: {
  meal: Meal
  date: string
  items: IntakeRow[]
  h: TimelineHelpers
}) {
  const hasItems = items.length > 0
  const [prevHasItems, setPrevHasItems] = useState(hasItems)
  const [lingering, setLingering] = useState(false)
  /* 這一餐剛從「沒記」變成「記了」（同一天裡，換日期會重掛、不算）：節點彈一下（v2.141「加進來」） */
  const [justDone, setJustDone] = useState(false)
  if (hasItems !== prevHasItems) {
    setPrevHasItems(hasItems)
    if (prevHasItems && !hasItems) setLingering(true)
    if (!prevHasItems && hasItems) setJustDone(true)
  }
  const done = hasItems || lingering
  // 小計「滾上去」（v2.141「加進來」）：變大時從舊值滾到新值（480ms、先快後慢）；變小、第一次、減少動態直接到位
  const kcal = useCountUp(Math.round(sumIntake(items).kcal))
  /* 剛加入的那幾筆依序落下（間隔 70ms）；只看 justAdded，載入、換日期、編輯都不會動 */
  const addedOrder = items.filter((r) => h.justAddedIds.has(r.id)).map((r) => r.id)
  const suggestion = h.repeatByMeal[meal.key]
  const repeatKey = `${date}|${meal.key}`

  return (
    /* v2.141：時間軸請回來（使用者 2026-11-15 選樣張 B）：左邊一條細線串四餐、每餐一個節點（記了＝實心打勾、沒記＝空心）。
       v2.122 曾把它拿掉、改由插圖的踏腳石說哪幾餐記了；使用者知道兩者重複，選它是為了四餐對齊同一條線、讀起來井然。
       節點是裝飾（aria-hidden）：記了的餐標題列有小計，讀屏靠有沒有數字分辨（同 v2.122 之前，不是這次新增的落差）。 */
    <div className={`node${done ? ' is-done' : ''}`}>
      <span className={`node-dot${justDone ? ' just-done' : ''}`} aria-hidden="true" onAnimationEnd={() => setJustDone(false)}>
        {done && (
          <svg viewBox="0 0 18 18">
            <path d="M5 9.2l2.6 2.6 5.4-5.6" />
          </svg>
        )}
      </span>
      <div className={`node-body${done ? '' : ' is-todo'}`}>
        {done ? (
          <>
            <button className="node-head" type="button" onClick={() => h.onOpenSheet(meal.key)}>
              <span className="node-name">{meal.label}</span>
              <CategoryStack categories={iconStack(items.map((r) => r.foods?.category))} />
              <span className="node-kcal">{kcal}</span>
            </button>
            <ul className="items">
              {/* 刪除那一列淡出、其餘用 layout 的 FLIP 滑上來——兩者都只動 transform／
                  opacity，沒有動 height（DESIGN.md「不動 layout 屬性」）。 */}
              {/* 不寫 initial={false}：它會擋掉所有子項的 initial，剛加入的品項落不下來（v2.141 review）。
                  每一列自己決定：只有 justAdded 的列有 initial，載入、換日期、重撈都停著不動 */}
              <AnimatePresence onExitComplete={() => setLingering(false)}>
                {items.map((r) => {
                  /* intake 自己的品名快照優先於 foods 的：改過名的那筆從此與食品庫脫鉤，
                     食品庫日後改品名不回頭改寫它（與 kcal/protein/fat/carb 同一套語意）。 */
                  const baseName = r.name ?? r.foods?.name ?? '（食物已刪除）'
                  // 份量微調接在品名後（中杯・微糖）；判斷適用與否看食品庫那一筆的品名與類型
                  const suffix = r.foods ? suffixOf(r.mods, { name: r.foods.name, category: r.foods.category }) : ''
                  return (
                    <motion.li
                      className="item"
                      data-row={r.id}
                      key={r.id}
                      layout
                      initial={addedOrder.includes(r.id) && !reduceMotion() ? { opacity: 0, y: -8 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -32 }}
                      transition={
                        reduceMotion()
                          ? { duration: 0 }
                          : { duration: sec(DUR.mid), ease: EASE, delay: Math.max(0, addedOrder.indexOf(r.id)) * 0.07 }
                      }
                    >
                      <SwipeRow
                        row={r}
                        name={baseName}
                        suffix={suffix}
                        vendor={rowVendor(r)}
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
                        modBase={h.modBaseOf(r)}
                      />
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          </>
        ) : (
          <>
            <button className="todo-row" type="button" onClick={() => h.onOpenSheet(meal.key)}>
              <span className="lb">{meal.label}</span>
              <span className="chev" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </span>
            </button>
            {/* 這週還沒讀到就不問：還不知道伺服器上有沒有按過沒吃（review S2） */}
            {h.skipsReady && isMainMeal(meal.key) && askSkip(meal.key, date, h.today, h.hour) && (
              <SkipAsk meal={meal.key} label={meal.label} skipped={h.skips.has(meal.key)} onOpenSheet={() => h.onOpenSheet(meal.key)} onSetSkip={h.onSetSkip} />
            )}
            {suggestion && (
              <SuggestRow
                suggestion={suggestion}
                mealLabel={meal.label}
                busy={h.repeatBusyKey === repeatKey}
                locked={h.repeatBusyKey !== null}
                err={h.repeatErr?.key === repeatKey ? h.repeatErr.msg : null}
                onAdd={() => h.onAddRepeat(date, suggestion)}
                onSwap={() => h.onSwapRepeat(meal.key)}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* 待記錄的三餐問一下「沒吃／補記」（v2.165，spec「熱量看這一週」）：這週卡把沒交代的餐補到目標（保守算），
   按「沒吃」那餐照實算 0、不再問；按了之後同一行換成「沒吃了」＋「取消」。「補記」＝開這一餐的記一筆。
   寫入失敗在下面一行「存不進去：」（同餐建議），鎖住用 aria-disabled（焦點不掉）。 */
function SkipAsk({
  meal,
  label,
  skipped,
  onOpenSheet,
  onSetSkip,
}: {
  meal: MainMeal
  label: string
  skipped: boolean
  onOpenSheet: () => void
  onSetSkip: (meal: MainMeal, on: boolean) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // 按了之後這一行換掉、焦點所在的鈕也不見了：結果用一句話唸出來（review N3）
  const [said, setSaid] = useState('')
  const set = async (on: boolean) => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      await onSetSkip(meal, on)
      setSaid(on ? `已記下${label}沒吃` : `已取消「${label}沒吃」`)
    } catch (e) {
      setErr(friendlyError(errMsg(e)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="skip-ask" data-meal={meal}>
        {skipped ? (
          <>
            <span className="lb">{label}沒吃</span>
            <button type="button" aria-disabled={busy || undefined} aria-label={`取消「${label}沒吃」`} onClick={() => void set(false)}>
              取消
            </button>
          </>
        ) : (
          <>
            <span className="lb">沒記到{label}？</span>
            <button type="button" aria-disabled={busy || undefined} aria-label={`${label}沒吃`} onClick={() => void set(true)}>
              沒吃
            </button>
            <button type="button" aria-label={`補記${label}`} onClick={onOpenSheet}>
              補記
            </button>
          </>
        )}
      </div>
      {err && (
        <p className="sheet-error" role="alert">
          存不進去：{err}
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {said}
      </span>
    </>
  )
}

/** 記完一餐那句話停多久（含進退場）。 */
const LOG_TOAST_MS = 2200

const SOURCE_LABEL: Record<SuggestSource, string> = { gap: '建議', frequent: '常吃', last: '上次' }

/* 待記錄那一列底下的一行建議：放不下的品項寧可截斷也不長高（sheet 與加入後的時間軸都看得到全部）。
   只有寫入失敗時多一行錯誤，卡片還在、按鈕變重試。
   鎖住用 aria-disabled，不用 disabled：按下去那顆鈕馬上就鎖，disabled 會讓焦點掉回 body，失敗轉「重試」時鍵盤使用者就迷路了。
   「換一個」只有依缺口挑、候選 > 1 時才有；換了整列淡綠閃一下（同「剛加入」），讓人知道內容換了。 */
function SuggestRow({
  suggestion,
  mealLabel,
  busy,
  locked,
  err,
  onAdd,
  onSwap,
}: {
  suggestion: RepeatSuggestion
  mealLabel: string
  busy: boolean
  locked: boolean
  err: string | null
  onAdd: () => void
  onSwap: () => void
}) {
  const label = suggestLabel(suggestion)
  const kcal = Math.round(suggestion.kcal)
  const src = SOURCE_LABEL[suggestion.source]
  const over = suggestion.overKcal
  const kcalSpoken = over === null ? `${kcal} 卡` : `${kcal} 卡，超過 ${over} 卡`
  const swappable = suggestion.source === 'gap' && suggestion.total > 1
  // 每按一次換一個新 key，閃的那層重掛、動畫重播
  const [flash, setFlash] = useState(0)
  return (
    <>
      <div className="sg">
        {flash > 0 && <span className="sg-flash" key={flash} aria-hidden="true" />}
        <CategoryIcon category={leadCategory(suggestion.items.map((it) => it.category))} size={32} decorative />
        <span className="sg-src">{src}</span>
        <span className="sg-items">{label}</span>
        {over === null ? (
          <span className="sg-kc">{kcal}</span>
        ) : (
          <span className="sg-kc is-over">
            超 <span className="n">{over}</span> 卡
          </span>
        )}
        {swappable && (
          <button
            className="sg-swap"
            type="button"
            aria-disabled={locked || undefined}
            aria-label={`換一個${mealLabel}建議`}
            onClick={
              locked
                ? undefined
                : () => {
                    onSwap()
                    setFlash((n) => n + 1)
                  }
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9h13l-3.5-3.5" />
              <path d="M20 15H7l3.5 3.5" />
            </svg>
          </button>
        )}
        <button
          className="sg-add"
          type="button"
          aria-disabled={locked || undefined}
          aria-label={busy ? '正在加入…' : `${err ? '重試加入' : '加入'}${src}的${mealLabel}：${label}，${kcalSpoken}`}
          onClick={locked ? undefined : onAdd}
        >
          {busy ? '加入中…' : err ? '重試' : '加入'}
        </button>
      </div>
      {err && (
        <p className="sheet-error" role="alert">
          存不進去：{err}
        </p>
      )}
    </>
  )
}
