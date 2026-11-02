import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useSortable } from '@dnd-kit/react/sortable'
import ExerciseThumb from '@/components/ExerciseThumb'
import { usePressed } from '@/components/usePressed'
import SwipeDelete from '@/components/SwipeDelete'
import { CASCADE_STEP_MS, DUR, SPRING_CARD, sec } from '@/lib/durations'
import { hasCatalogImage, muscleGroupLabel } from '@/lib/exerciseCatalog'
import {
  allSetsDone,
  cardioRecorded,
  cardioSummary,
  exerciseDisplayName,
  exerciseProgress,
  formatKg,
  isCardioCard,
  type Row,
  type WorkoutExerciseDetail,
} from '@/lib/training'

/** 收合列的第二行：小圓點一組一顆（做完的實心）加下一組；超過 8 組圓點省略、補「d/n 組」。不顯示分數。 */
const MAX_DOTS = 8
function Progress({ sets }: { sets: readonly Row[] }) {
  const { done, total, next } = exerciseProgress(sets)
  if (total === 0) return <>沒有組</>
  const nextText = next ? `下一組 ${formatKg(next.weight)} kg × ${next.reps}` : '全部完成'
  return (
    <span className="prog">
      <span className="sr-only">{`已完成 ${done} 組，共 ${total} 組。`}</span>
      {total <= MAX_DOTS ? (
        <span className="dots" aria-hidden="true">
          {sets.map((s) => (
            <i key={s.id} className={s.done === true ? 'dot is-done' : 'dot'} />
          ))}
        </span>
      ) : (
        <span aria-hidden="true">{`${done}/${total} 組`}</span>
      )}
      <span aria-hidden={total <= MAX_DOTS ? undefined : true}>{nextText}</span>
    </span>
  )
}

/* ═══════════ 一組 ═══════════ */

interface SetRowProps {
  set: Row
  no: number
  canDelete: boolean
  swipeOpen: boolean
  /** 同步剩餘組數剛改到這一列：它在被改的列裡排第幾個（淡綠閃一下，依序錯開）；沒被改＝null。 */
  flashIndex: number | null
  /** 全部完成剛換了這一列：它在被換的列裡排第幾個（打勾的顏色變化依序延後）；沒被換＝null。 */
  cascadeIndex: number | null
  onSwipe: (open: boolean) => void
  onEdit: (opener: HTMLElement) => void
  onToggle: () => void
  onDelete: () => void
}

function SetRow({ set, no, canDelete, swipeOpen, flashIndex, cascadeIndex, onSwipe, onEdit, onToggle, onDelete }: SetRowProps) {
  const weight = Number(set.weight_kg)
  const reps = Number(set.reps)
  const done = set.done === true
  const checkPress = usePressed()
  const rowStyle: CSSProperties = {}
  if (flashIndex !== null) rowStyle.animationDelay = `${flashIndex * 50}ms`
  if (cascadeIndex !== null) (rowStyle as Record<string, string>)['--cascade-delay'] = `${cascadeIndex * CASCADE_STEP_MS}ms`
  return (
    <SwipeDelete open={swipeOpen} onOpenChange={onSwipe} onDelete={onDelete} deleteLabel={`刪除第 ${no} 組`} disabled={!canDelete}>
      <div
        className={`set${done ? ' done' : ''}${flashIndex !== null ? ' is-synced' : ''}${cascadeIndex !== null ? ' is-cascade' : ''}`}
        data-set-id={set.id}
        style={rowStyle}
      >
        <span className="no">
          {no}
          {/* 有填 RPE 的組在組號格右上角掛一顆小標籤（v2.105，樣張 rpe-badge A：只有數字、不分強度；v2.106 起用強調色）；沒填的不變。
              RPE 只在打勾的組有意義，同組編輯 sheet。v2.107 起它是按鈕：點了開那一組的組編輯 sheet（RPE 唯一能改的地方）。 */}
          {done && set.rpe != null && (
            <button
              className="rpe-badge"
              type="button"
              aria-label={`第 ${no} 組 RPE ${Number(set.rpe)}，調整`}
              onClick={(e) => onEdit(e.currentTarget)}
            >
              {Number(set.rpe)}
            </button>
          )}
        </span>
        <button
          className="tr-val w"
          type="button"
          aria-label={`第 ${no} 組重量 ${formatKg(weight)} 公斤，調整`}
          onClick={(e) => onEdit(e.currentTarget)}
        >
          {formatKg(weight)}
        </button>
        <button className="tr-val r" type="button" aria-label={`第 ${no} 組次數 ${reps}，調整`} onClick={(e) => onEdit(e.currentTarget)}>
          {reps}
        </button>
        <button className="tr-check" type="button" aria-pressed={done} aria-label={`第 ${no} 組完成`} onClick={onToggle} {...checkPress}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </button>
      </div>
    </SwipeDelete>
  )
}

/* ═══════════ 要點條 ═══════════ */

/** 展開的動作卡頂部的要點：有要點→最多兩行、點一下原地變輸入框；沒寫過→一行淡色「加要點」。
 *  失焦才存（內容有變才寫）；Esc 放棄這次的改動；Enter 是換行（要點是多行文字）。
 *  要點屬於**動作**不屬於這次訓練：改了，其他訓練裡同一個動作也跟著變（與動作庫的編輯一致）。 */
function TipsStrip({ name, exercise, onSave }: { name: string; exercise: Row; onSave: (exercise: Row, tips: string) => Promise<boolean> }) {
  const tips = typeof exercise.tips === 'string' ? exercise.tips.trim() : ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  // Esc＝放棄這次的改動：失焦時不存。每次開始編輯都重設，免得上次留下的旗標吃掉下一次的存檔
  const cancelled = useRef(false)

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useLayoutEffect(() => {
    const el = area.current
    if (!editing || !el) return
    grow(el)
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const begin = () => {
    cancelled.current = false
    setDraft(tips)
    setEditing(true)
  }
  const finish = async () => {
    if (cancelled.current) {
      setEditing(false)
      return
    }
    if (draft.trim() === tips) {
      setEditing(false)
      return
    }
    if (await onSave(exercise, draft)) setEditing(false)
  }

  if (!editing) {
    return (
      <button
        className={`ex-tips${tips ? '' : ' is-empty'}`}
        type="button"
        aria-label={tips ? `${name} 的要點：${tips}。點一下編輯` : `${name}：加要點`}
        onClick={begin}
      >
        {tips || '加要點'}
      </button>
    )
  }
  return (
    <div
      className="ex-tips-wrap"
      // 失焦收尾放在外層：焦點從輸入框用 Tab 移到清空鈕時（relatedTarget 仍在 wrap 裡）不收，否則鍵盤按得到 ✕ 的瞬間整塊就卸載、焦點掉回 body
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
        void finish()
      }}
    >
      <textarea
        ref={area}
        className="ex-tips-input"
        aria-label={`${name} 的要點`}
        rows={1}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          grow(e.target)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.stopPropagation()
          // 自己 blur 一次：收尾（放棄、收起輸入框）全走 finish 這一條路，不靠「卸載時瀏覽器補不補 blur」
          cancelled.current = true
          e.currentTarget.blur()
        }}
      />
      {/* 清空（v2.104）：只在有字時出現；按下時不能讓輸入框失焦（失焦就存），所以擋掉 pointerdown／mousedown 的預設行為，
          清完把焦點留在輸入框，使用者可以接著打新的；真正存檔還是失焦那一下（內容有變才寫，清空存 null） */}
      {draft !== '' && (
        <button
          className="ex-tips-clear"
          type="button"
          aria-label={`清空${name}的要點`}
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setDraft('')
            const el = area.current
            if (el) {
              el.value = ''
              grow(el)
              el.focus({ preventScroll: true })
            }
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </button>
      )}
    </div>
  )
}

/* ═══════════ 一張動作卡 ═══════════ */

interface ExerciseCardProps {
  item: WorkoutExerciseDetail
  index: number
  open: boolean
  /** 排序中：所有卡一併收起。 */
  sorting: boolean
  swipeId: string | null
  flash: readonly string[]
  cascade: readonly string[]
  onToggleOpen: () => void
  /** 有氧卡的名稱鈕：開有氧 sheet（有氧卡不展開）。 */
  onOpenCardio: () => void
  /** 就地存要點；回 false＝沒存成（頁面已顯示錯誤），要點條留在編輯狀態保住打的字。 */
  onSaveTips: (exercise: Row, tips: string) => Promise<boolean>
  onReplace: () => void
  onRemove: () => void
  onToggleAll: () => void
  onAddSet: () => void
  onSwipe: (setId: string, open: boolean) => void
  onEditSet: (setId: string, opener: HTMLElement) => void
  onToggleSet: (set: Row) => void
  onDeleteSet: (setId: string) => void
}

export default function ExerciseCard(p: ExerciseCardProps) {
  const { item, index, sorting } = p
  const { entry, exercise, sets } = item
  const reduced = useReducedMotion()
  const allPress = usePressed()
  const name = exerciseDisplayName(exercise)
  const group = exercise ? muscleGroupLabel(exercise.muscle_group) : ''
  // 有圖的動作（目錄裡有圖的預設動作，含有氧的坡度健走；由 exerciseCatalog.test 鎖住）縮圖是獨立的放大鈕；沒圖的（自建、已刪除、
  // 資料集沒有對應的三個預設動作）肌群單字或類型圖示留在 ex-toggle 裡，點它仍是名稱鈕的動作，不留點不到的死區
  const photo = exercise != null && hasCatalogImage(exercise)
  // 有氧卡沒有組：永遠收合，名稱鈕改開有氧 sheet
  const cardio = isCardioCard(item)
  const open = !cardio && p.open && !sorting
  const { ref, handleRef, isDragging } = useSortable({ id: entry.id, index, data: { name } })
  const spring = reduced ? { duration: 0.01 } : { height: SPRING_CARD, opacity: { duration: 0.16 } }
  // 新增／刪除一組（spec 動效表）：新增＝新列由上方 8px 淡入 220ms ease-out；刪除＝該列淡出並左移 12px 160ms ease-in。
  // 刪除時高度一併收到 0（同 160ms），不然下面的列要等淡出結束才「跳」上來；overflow 只在退場時才裁，免得平常裁掉聚焦外框。
  // 減少動態：位移與高度都省掉，只剩 ≤120ms 的淡入淡出。
  const rowMotion = reduced
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.12 } },
        exit: { opacity: 0, transition: { duration: 0.12 } },
      }
    : {
        initial: { opacity: 0, y: -8 },
        animate: { opacity: 1, y: 0, transition: { duration: sec(DUR.mid), ease: 'easeOut' as const } },
        exit: { opacity: 0, x: -12, height: 0, overflow: 'hidden', transition: { duration: sec(DUR.base), ease: 'easeIn' as const } },
      }
  const allDone = allSetsDone(sets)

  return (
    <section
      ref={ref}
      className={`tr-card ex${cardio ? ' is-cardio' : ''}${open ? '' : ' collapsed'}${isDragging ? ' is-dragging' : ''}`}
      aria-label={name}
      data-entry-id={entry.id}
    >
      <div className="ex-head">
        <button className="tr-grip" type="button" ref={handleRef} aria-label={`拖曳排序：${name}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
          </svg>
        </button>
        {/* 縮圖是獨立的放大鈕，不能包在展開／收合的按鈕裡：與 ex-toggle 並排 */}
        {photo ? <ExerciseThumb exercise={exercise} zoom /> : null}
        {cardio ? (
          // 有氧卡：整條名稱鈕開 sheet，不是展開（沒有 aria-expanded）；右側 › 在這裡表示「點進去」
          <button className="ex-toggle" type="button" aria-haspopup="dialog" onClick={p.onOpenCardio}>
            {/* 坡度健走有圖：縮圖已是外面的放大鈕，這裡不能再放一個 */}
            {photo ? null : <ExerciseThumb exercise={exercise} />}
            <span className="grow">
              <span className="nm">{name}</span>
              <span className="sub">
                {cardioRecorded(entry) ? (
                  <span className="cardio-sum">{cardioSummary(entry)}</span>
                ) : (
                  <span className="is-missing">點一下填寫</span>
                )}
              </span>
            </span>
            <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <button className="ex-toggle" type="button" aria-expanded={open} onClick={p.onToggleOpen}>
            {photo ? null : <ExerciseThumb exercise={exercise} />}
            <span className="grow">
              <span className="nm">{name}</span>
              {/* key 隨展開狀態換：第二行換內容時整段重新淡入（下移 35%） */}
              <span className="sub" key={open ? 'group' : 'progress'}>
                {open ? group : <Progress sets={sets} />}
              </span>
            </span>
            <svg className={`chev${open ? ' is-open' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        )}
        {/* 每張卡都有替換鈕（有氧卡也有）：箭頭、替換、移除在各卡上才對得齊。要換動作比看要點頻繁，所以佔 ⓘ 原本的位置 */}
        <button className="tr-ib ex-swap" type="button" aria-label={`${name}：替換動作`} onClick={p.onReplace}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 7h11l-3-3M17 17H6l3 3" />
          </svg>
        </button>
        {/* v2.99 拆掉 ⋯ 選單（只剩移除一項）、直接放移除鈕；v2.101 圖示從 ✕ 改成紅色垃圾桶（使用者要求，頂欄的「刪除這次訓練」也跟著紅）。
            兩顆長得一樣、範圍不同，靠各自確認框的標題與內文分開。一律先跳確認框，所以像有氧卡的名稱鈕一樣標 aria-haspopup */}
        <button className="tr-ib is-danger ex-remove" type="button" aria-haspopup="dialog" aria-label={`${name}：移除動作`} onClick={p.onRemove}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
          </svg>
        </button>
      </div>

      {/* 排序中整段不掛 AnimatePresence：沒有退場動畫，收合在同一次 commit 完成。dnd-kit 在 beforedragstart 之後
          等 React 渲染完才量尺寸並凍結被拖那張的寬高，退場動畫還在跑的話量到的是展開時的高度 */}
      {!sorting && (
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="body"
              className="ex-body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={spring}
              style={{ overflow: 'hidden' }}
            >
              {exercise && <TipsStrip name={name} exercise={exercise} onSave={p.onSaveTips} />}
              <div className="set-head">
                <span aria-hidden="true">組</span>
                <span aria-hidden="true">重量 kg</span>
                <span aria-hidden="true">次數</span>
                <button
                  className={`tr-all${allDone ? ' is-on' : ''}`}
                  type="button"
                  aria-pressed={allDone}
                  aria-label={allDone ? '取消全部完成' : '全部完成'}
                  disabled={sets.length === 0}
                  onClick={p.onToggleAll}
                  {...allPress}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2.5 12.5l4 4M7.5 16.5L16.5 7.5M12 16.5l1 1L22 8.5" />
                  </svg>
                </button>
              </div>
              {/* initial={false}：卡片展開時已有的組不跑進場，只有展開之後才新增／刪掉的才動 */}
              <AnimatePresence initial={false}>
                {sets.map((s, i) => (
                  <motion.div key={s.id} className="set-slot" initial={rowMotion.initial} animate={rowMotion.animate} exit={rowMotion.exit}>
                    <SetRow
                      set={s}
                      no={i + 1}
                      canDelete={sets.length > 1}
                      swipeOpen={p.swipeId === s.id}
                      flashIndex={p.flash.includes(s.id) ? p.flash.indexOf(s.id) : null}
                      cascadeIndex={p.cascade.includes(s.id) ? p.cascade.indexOf(s.id) : null}
                      onSwipe={(o) => p.onSwipe(s.id, o)}
                      onEdit={(opener) => p.onEditSet(s.id, opener)}
                      onToggle={() => p.onToggleSet(s)}
                      onDelete={() => p.onDeleteSet(s.id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              <button className="tr-addset" type="button" onClick={p.onAddSet}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                新增一組
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </section>
  )
}
