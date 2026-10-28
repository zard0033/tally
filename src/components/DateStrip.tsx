/* 日期元件（v2.53）：週列＋可展開的月曆，取代 v2.4 的 `‹ 日期 ›` 膠囊。
   原因與被推翻的舊決定（不做月曆、不做橫條、日期文字不當按鈕）見 DESIGN.md「日期切換」條：
   那三條的前提是「記帳只往回翻幾天」，訓練補記與月覽打破了它。

   選中態用 aria-pressed、不用 aria-current（DESIGN v2.30：aria-current 只留給底部分頁列），
   「今天」只靠外圈與無障礙名稱的「，今天」。左右滑切週是手勢，**沒有按鈕替代**——
   非手勢的路徑是月曆（任何日期都點得到）。上界跟 `maxPlanDate()`（＝明天）。

   不在這裡抓資料：小點要哪幾個月由 onViewMonth 回報，App 去撈。

   展開收合的動效（spec「日期元件展開收合動效」）：週列與月曆各自包在 `Panel` 裡，用 AnimatePresence 同時進退場——
   進場的 height 0→auto＋淡入（SPRING_CARD，與動作卡展開同一條），退場的反向，下面的內容被平順推開。
   **不做週列變形成月曆**：週列涵蓋的那週可能跨月，月曆只畫當月，那週在月曆裡會缺格。
   月曆各列由上往下錯開淡入、換月時整張往對應方向滑一下，這兩個用 CSS 動畫（app.css），因為一張月曆有 40 多顆按鈕。
   退場中的那一份還在 DOM 裡：`inert`＋`aria-hidden`＋`data-leaving`，不可點、讀屏不念、焦點與 e2e 的選取都要排除它。

   放在 components/ 而不是 screens/：CLAUDE.md 的判準是「同一組互動出現在兩個以上的 screen」，
   這顆的第二個使用者（訓練頁）是已核可樣張裡確定的，使用者也裁決兩頁日期軸必須一致，
   不是「看起來可以抽」。 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import Flip from '@/components/Flip'
import { DUR, REDUCED_FADE_MAX_MS, SPRING_CARD, sec } from '@/lib/durations'
import {
  addMonths,
  dayLabel,
  isMonthBeyond,
  localDate,
  maxPlanDate,
  monthGrid,
  monthKeyOf,
  monthTitle,
  shiftDate,
  weekDates,
  weekdayDate,
  type MonthKey,
} from '@/lib/dates'

const DOW = ['一', '二', '三', '四', '五', '六', '日']
/** 水平位移超過它、且明顯大於垂直位移，才算「切週」 */
const SWIPE_MIN = 48
/** 切週手勢結束後，瀏覽器補的那一下 click 要吃掉（同 Today 左滑刪除的作法） */
const CLICK_GRACE_MS = 150

/** 週列與月曆的共同外殼：進退場動畫與「退場中」的標記。必須是 AnimatePresence 的直接子元件，useIsPresent 才讀得到。
 *  減少動態（AC 10）：不動高度，進場只淡入（≤120ms），退場立刻消失。 */
function Panel({ reduced, children }: { reduced: boolean | null; children: ReactNode }) {
  const present = useIsPresent()
  const motionProps = reduced
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: sec(REDUCED_FADE_MAX_MS) } },
        exit: { opacity: 0, transition: { duration: 0 } },
      }
    : {
        initial: { height: 0, opacity: 0 },
        animate: { height: 'auto', opacity: 1 },
        exit: { height: 0, opacity: 0 },
        transition: { height: SPRING_CARD, opacity: { duration: sec(DUR.base) } },
      }
  return (
    <motion.div
      className="datectl-panel"
      inert={!present}
      aria-hidden={present ? undefined : true}
      data-leaving={present ? undefined : ''}
      {...motionProps}
    >
      {children}
    </motion.div>
  )
}

/** 月曆進場的方式：展開時各列錯開淡入；換月時往對應方向滑。 */
type MonthAnim = 'open' | 'next' | 'prev'

interface DateStripProps {
  /** 目前選中的日期 yyyy-mm-dd */
  date: string
  /** 有紀錄的日子（小點）。只含已載入的月份，沒載到的月份沒有小點，不是「沒紀錄」。 */
  marked: ReadonlySet<string>
  /** 選了某天。上界與非法值由呼叫端擋，這裡只在 UI 上把超過明天的日子停用。 */
  onSelect: (iso: string) => void
  /** 目前畫面（週列涵蓋的月份或月曆翻到的月份）需要哪個月的小點資料。 */
  onViewMonth: (key: MonthKey) => void
}

export default function DateStrip({ date, marked, onSelect, onViewMonth }: DateStripProps) {
  const today = localDate()
  const max = maxPlanDate()
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState<MonthKey>(() => monthKeyOf(date))
  const reduced = useReducedMotion()
  // 換月時整張格子重掛（key）才會重播滑動；序號每次 +1，連按兩次同方向也要各播一次
  const [monthAnim, setMonthAnim] = useState<MonthAnim>('open')
  const [monthSeq, setMonthSeq] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLButtonElement>(null)
  /* 選了日期之後焦點要去哪：月曆收合時（Escape、回今天、點標題、點目前已選的那天；選別天不收，v2.101／v2.102）被點的那顆格子會卸載、
     週列換週時選中那顆也是新元素，不接的話焦點掉回 body，鍵盤使用者失去位置（同 v2.4「回今天」那條的教訓）。 */
  const refocus = useRef<'title' | 'day' | null>(null)
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const swipedAt = useRef(0)

  const week = weekDates(date)
  const months = open ? [viewMonth] : [...new Set([monthKeyOf(week[0]), monthKeyOf(week[6])])]
  const monthsKey = months.join()
  /* date 也放進依賴：上次抓失敗的月份，換個日期時會再要一次（App 那邊有去重，已載入的不會重打），
     不然失敗後要翻到別的月份再翻回來才會重試（review 抓到）。 */
  useEffect(() => {
    for (const k of monthsKey.split(',')) onViewMonth(k)
  }, [monthsKey, date, onViewMonth])

  useLayoutEffect(() => {
    const target = refocus.current
    if (!target) return
    refocus.current = null
    if (target === 'title') titleRef.current?.focus({ preventScroll: true })
    // 退場中的那一份（data-leaving）還在 DOM 裡，也有選中的格子，要排除，不然焦點會落進 inert 的元素
    else rootRef.current?.querySelector<HTMLElement>(':scope > :not([data-leaving]) .datectl-day[aria-pressed="true"]')?.focus({ preventScroll: true })
  }, [date, open])

  /* v2.101：月曆開著時選**別天**不收合（使用者：點其他日期時不需要主動收起來，連續看幾天比較順）；
     點**目前已選的那天**會收合（使用者 2026-10-28：這是一個會發生的動作，要保留），焦點回標題。
     被點的那顆格子不會卸載（同一個月的格子沒有換 key），焦點本來就在它身上，所以不用 refocus；週列選日期照舊（週列換週時選中那顆是新元素）。 */
  const pick = (iso: string) => {
    if (iso > max) return
    if (iso === date) {
      if (open) {
        refocus.current = 'title'
        setOpen(false)
      }
      return
    }
    if (!open) refocus.current = 'day'
    onSelect(iso)
  }

  const toggleMonth = () => {
    if (!open) {
      setViewMonth(monthKeyOf(date))
      setMonthAnim('open')
    }
    setOpen(!open)
  }

  const goMonth = (delta: 1 | -1) => {
    setViewMonth(addMonths(viewMonth, delta))
    setMonthAnim(delta > 0 ? 'next' : 'prev')
    setMonthSeq((n) => n + 1)
  }

  const goToday = () => {
    setOpen(false)
    onSelect(today)
    // 這顆鈕自己會被卸載（今天時不放東西），焦點在同一個 handler 裡搶先移到還在的容器
    rootRef.current?.focus()
  }

  const renderDay = (iso: string, withDow: boolean, row = 0) => {
    const isMarked = marked.has(iso)
    return (
      <button
        key={iso}
        type="button"
        className={`datectl-day${iso === today ? ' is-today' : ''}${isMarked ? ' is-marked' : ''}`}
        data-date={iso}
        style={{ '--r': row } as CSSProperties}
        aria-pressed={iso === date}
        aria-label={dayLabel(iso, today, isMarked)}
        disabled={iso > max}
        onClick={() => {
          if (Date.now() - swipedAt.current < CLICK_GRACE_MS) return
          pick(iso)
        }}
      >
        {withDow && <span className="dw">{DOW[week.indexOf(iso)]}</span>}
        <span className="n">{Number(iso.slice(8))}</span>
      </button>
    )
  }

  return (
    <div
      className="datectl"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          refocus.current = 'title'
          setOpen(false)
        }
      }}
    >
      <div className="datectl-head">
        <h1 className="date-title">
          <button
            ref={titleRef}
            type="button"
            className="datectl-title"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={toggleMonth}
          >
            {weekdayDate(date)}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </h1>
        {date !== today && (
          <button type="button" className="date-today-btn" onClick={goToday}>
            回今天
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <Panel key="month" reduced={reduced}>
            <div className="datectl-month" id={panelId} data-month={viewMonth} role="group" aria-label={monthTitle(viewMonth)}>
              <div className="datectl-mhead">
                <span className="datectl-mt">
                  <Flip text={monthTitle(viewMonth)} ms={DUR.base} />
                </span>
                <button type="button" className="datectl-mnav" aria-label="上個月" onClick={() => goMonth(-1)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="datectl-mnav"
                  aria-label="下個月"
                  disabled={isMonthBeyond(addMonths(viewMonth, 1), max)}
                  onClick={() => goMonth(1)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
              {/* --r：第幾列（星期標題是第 0 列），CSS 用它算錯開的延遲 */}
              <div className={`datectl-grid anim-${monthAnim}`} key={`${viewMonth}:${monthSeq}`} data-anim={monthAnim}>
                {DOW.map((n) => (
                  <span className="datectl-dow" key={n} aria-hidden="true" style={{ '--r': 0 } as CSSProperties}>
                    {n}
                  </span>
                ))}
                {monthGrid(viewMonth).map((iso, i) =>
                  iso === null ? (
                    <span key={`b${i}`} />
                  ) : (
                    renderDay(iso, false, 1 + Math.floor(i / 7))
                  ),
                )}
              </div>
            </div>
          </Panel>
        ) : (
          <Panel key="week" reduced={reduced}>
            <div
              className="datectl-grid datectl-week"
              role="group"
              aria-label="這一週"
              onPointerDown={(e) => {
                swipeStart.current = { x: e.clientX, y: e.clientY }
              }}
              onPointerCancel={() => {
                swipeStart.current = null
              }}
              onPointerUp={(e) => {
                const s = swipeStart.current
                swipeStart.current = null
                if (!s) return
                const dx = e.clientX - s.x
                const dy = e.clientY - s.y
                if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return
                swipedAt.current = Date.now()
                /* 往未來滑夾到上界（明天）而不是整個丟掉：從上週的週五往左滑，+7 天會越界，
                   丟掉的話永遠滑不回本週。夾完還在同一週＝沒有「下一週」可切，不動。 */
                const step = shiftDate(date, dx < 0 ? 7 : -7)
                const target = step > max ? max : step
                if (target === date || weekDates(target)[0] === week[0]) return
                refocus.current = 'day'
                onSelect(target)
              }}
            >
              {week.map((iso) => renderDay(iso, true))}
            </div>
          </Panel>
        )}
      </AnimatePresence>
    </div>
  )
}
