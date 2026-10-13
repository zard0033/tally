/* 日期元件（v2.53）：週列＋可展開的月曆，取代 v2.4 的 `‹ 日期 ›` 膠囊。
   原因與被推翻的舊決定（不做月曆、不做橫條、日期文字不當按鈕）見 DESIGN.md「日期切換」條：
   那三條的前提是「記帳只往回翻幾天」，訓練補記與月覽打破了它。

   選中態用 aria-pressed、不用 aria-current（DESIGN v2.30：aria-current 只留給底部分頁列），
   「今天」只靠外圈與無障礙名稱的「，今天」。左右滑切週是手勢，**沒有按鈕替代**——
   非手勢的路徑是月曆（任何日期都點得到）。上界跟 `maxPlanDate()`（＝明天）。

   不在這裡抓資料：小點要哪幾個月由 onViewMonth 回報，App 去撈。

   放在 components/ 而不是 screens/：CLAUDE.md 的判準是「同一組互動出現在兩個以上的 screen」，
   這顆的第二個使用者（訓練頁）是已核可樣張裡確定的，使用者也裁決兩頁日期軸必須一致，
   不是「看起來可以抽」。 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
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
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLButtonElement>(null)
  /* 選了日期之後焦點要去哪：月曆收合時被點的那顆格子會卸載、週列換週時選中那顆也是新元素，
     不接的話焦點掉回 body，鍵盤使用者失去位置（同 v2.4「回今天」那條的教訓）。 */
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
    else rootRef.current?.querySelector<HTMLElement>('.datectl-day[aria-pressed="true"]')?.focus({ preventScroll: true })
  }, [date, open])

  const pick = (iso: string) => {
    if (iso > max) return
    if (!open && iso === date) return
    refocus.current = open ? 'title' : 'day'
    setOpen(false)
    onSelect(iso)
  }

  const toggleMonth = () => {
    if (!open) setViewMonth(monthKeyOf(date))
    setOpen(!open)
  }

  const goToday = () => {
    setOpen(false)
    onSelect(today)
    // 這顆鈕自己會被卸載（今天時不放東西），焦點在同一個 handler 裡搶先移到還在的容器
    rootRef.current?.focus()
  }

  const renderDay = (iso: string, withDow: boolean) => {
    const isMarked = marked.has(iso)
    return (
      <button
        key={iso}
        type="button"
        className={`datectl-day${iso === today ? ' is-today' : ''}${isMarked ? ' is-marked' : ''}`}
        data-date={iso}
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

      {open ? (
        <div className="datectl-month" id={panelId} data-month={viewMonth} role="group" aria-label={monthTitle(viewMonth)}>
          <div className="datectl-mhead">
            <span className="datectl-mt">{monthTitle(viewMonth)}</span>
            <button type="button" className="datectl-mnav" aria-label="上個月" onClick={() => setViewMonth(addMonths(viewMonth, -1))}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <button
              type="button"
              className="datectl-mnav"
              aria-label="下個月"
              disabled={isMonthBeyond(addMonths(viewMonth, 1), max)}
              onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
          <div className="datectl-grid">
            {DOW.map((n) => (
              <span className="datectl-dow" key={n} aria-hidden="true">
                {n}
              </span>
            ))}
            {monthGrid(viewMonth).map((iso, i) => (iso === null ? <span key={`b${i}`} /> : renderDay(iso, false)))}
          </div>
        </div>
      ) : (
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
      )}
    </div>
  )
}
