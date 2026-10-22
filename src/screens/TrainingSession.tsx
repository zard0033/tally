/* 訓練中的整頁：一次訓練的所有動作與組，記組、打勾、調整、加動作、排序、完成。
   同一頁也用來重新打開已結束的訓練編輯（AC 8）：修改當下就存，不需要再按儲存。

   組的重量與次數不在列上打字：點它開「組編輯 sheet」（SetSheet，± 與大數字都在那裡，每次立即寫入）。
   列上只有兩顆數字鈕與一顆勾；整列可左滑露出紅鈕刪除。卡片頭固定四件事：握把、名稱（點了收合／展開）、
   ⓘ 要點（點了在卡片內展開面板）、⋯ 選單；收合時第二行是進度（圓點＋下一組），展開時是肌群。
   欄頭的雙勾是「全部完成」。排序只能從握把拖（@dnd-kit/react），拖起時所有卡收合、範圍限制在清單區內並有橡皮筋。
   有氧動作的卡（spec「有氧併入動作」）沒有組：永遠是收合的外觀，名稱鈕點了開有氧 sheet（CardioSheet），第二行是摘要或「點一下填寫」；
   沒有組列、全部完成、新增一組、RPE 頁尾，勾組才會觸發的休息條與重量建議也就碰不到。握把、ⓘ、⋯ 與其他卡相同。
   有氧動作卻有組的卡退回重訓的畫法（`isCardioCard`）。
   寫入全部走 onWrite（排進離線佇列、立刻反映在畫面上）。詳見 spec.md「訓練中畫面改版」。 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Menu } from '@base-ui/react/menu'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { move } from '@dnd-kit/helpers'
import ConfirmDialog from '@/components/ConfirmDialog'
import ExerciseThumb from '@/components/ExerciseThumb'
import Flip from '@/components/Flip'
import GymVisualCredit from '@/components/GymVisualCredit'
import RestBar, { type RpeAsk } from '@/components/RestBar'
import { useRestTimer } from '@/components/useRestTimer'
import { usePressed } from '@/components/usePressed'
import SwipeDelete from '@/components/SwipeDelete'
import { rubberBandToElement } from '@/components/rubberBandModifier'
import { sortableAccessibility } from '@/components/sortableA11y'
import { CASCADE_STEP_MS, DUR, REDUCED_FADE_MAX_MS, RPE_ASK_CLOSE_MS, SPRING_CARD, sec } from '@/lib/durations'
import { hasCatalogImage } from '@/lib/exerciseCatalog'
import CardioSheet from './CardioSheet'
import ExerciseEditSheet from './ExerciseEditSheet'
import ExercisePicker from './ExercisePicker'
import FinishSheet, { type FinishLine } from './FinishSheet'
import SetSheet, { type SetTarget } from './SetSheet'
import {
  MUSCLE_GROUP_LABEL,
  addExerciseOps,
  addSetOps,
  allSetsDone,
  cardioLastMinutes,
  cardioRecorded,
  cardioSummary,
  completesExercise,
  exerciseProgress,
  exerciseRpe,
  finishWorkoutOps,
  formatKg,
  isBackfilled,
  isCardioExercise,
  removeSetOps,
  reorderWorkoutExercisesOps,
  routineFromWorkoutOps,
  RPE_CHIPS,
  setExerciseRpeOps,
  setsOfDetail,
  toggleAllDoneOps,
  workoutSummary,
  type MuscleGroup,
  type Row,
  type RowOp,
  type TrainingDb,
  type WorkoutDetail,
  type WorkoutExerciseDetail,
} from '@/lib/training'

interface TrainingSessionProps {
  detail: WorkoutDetail
  db: TrainingDb
  onWrite: (ops: RowOp[]) => Promise<void>
  onBack: () => void
}

const newId = () => crypto.randomUUID()
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 這張卡用有氧的畫法：有氧動作、而且沒有組。有氧動作卻有組的卡（舊版 App 把有氧當重訓加進來；照課表開訓時
 *  動作還沒載到本機底、addExerciseOps 當重訓產了組）退回重訓的畫法——組看得到、刪得掉、打過勾的組移除前照樣先問。 */
const isCardioCard = (item: WorkoutExerciseDetail) => isCardioExercise(item.exercise) && item.sets.length === 0

/** m:ss；超過一小時就繼續累加分鐘（75:12），不換成時:分:秒——掃一眼看的是「大概多久」。 */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 進行中且即時的訓練才每秒跳；其餘不開計時器。 */
function useNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

/** 收合列的第二行：小圓點一組一顆（做完的實心）加下一組；超過 8 組圓點省略、補「d/n 組」。不顯示分數。 */
const MAX_DOTS = 8
/** 動作卡的頁尾：這個動作每一組都打勾之後，固定長在卡片最底（展開時在「新增一組」下面、收合時在標頭下面）。
 *  一個動作一個 RPE，和休息條是同一格；進行中的訓練才有。選中的是各組最大值對得上的那一顆（sheet 填的 6 沒有對應的 chip）。 */
function RpeFooter({ name, sets, show, onPick }: { name: string; sets: readonly Row[]; show: boolean; onPick: (rpe: number) => void }) {
  const reduced = useReducedMotion()
  const { complete, rpe } = exerciseRpe(sets)
  const shown = show && complete
  // 外層只動 height／opacity：border-box 下 height: 0 縮不到 padding 以下，所以分隔線與 padding 都放內層（同要點面板）
  const hidden = reduced ? { opacity: 0 } : { height: 0, opacity: 0 }
  const visible = reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          key="rpe-footer"
          className="ex-rpe"
          data-section="ex-rpe"
          initial={hidden}
          animate={visible}
          exit={hidden}
          transition={{ duration: sec(reduced ? Math.min(DUR.base, REDUCED_FADE_MAX_MS) : DUR.base), ease: 'easeOut' }}
        >
          <div className="ex-rpe-in">
            <div className="lbl">
              <span>最後一組還能再做幾下？</span>
              <span className="st">{rpe === null ? '還沒填' : `RPE ${rpe}`}</span>
            </div>
            <div className="opts" role="group" aria-label={`${name} 的吃力程度`}>
              {RPE_CHIPS.map((c) => (
                <button
                  key={c.rpe}
                  className={`opt${rpe === c.rpe ? ' is-on' : ''}`}
                  type="button"
                  data-rpe={c.rpe}
                  aria-pressed={rpe === c.rpe}
                  onClick={() => rpe !== c.rpe && onPick(c.rpe)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

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

const DotsIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 12h.01M12 12h.01M18 12h.01" />
  </svg>
)

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
        <span className="no">{no}</span>
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

/* ═══════════ 一張動作卡 ═══════════ */

interface ExerciseCardProps {
  item: WorkoutExerciseDetail
  /** 動作卡有沒有 RPE 頁尾：只在即時進行中的訓練（與休息條同一個條件，補記與已結束的沒有）。 */
  showRpe: boolean
  index: number
  open: boolean
  tipsOpen: boolean
  /** 排序中：所有卡與要點面板一併收起。 */
  sorting: boolean
  swipeId: string | null
  flash: readonly string[]
  cascade: readonly string[]
  onToggleOpen: () => void
  /** 有氧卡的名稱鈕：開有氧 sheet（有氧卡不展開）。 */
  onOpenCardio: () => void
  onToggleTips: () => void
  onEditTips: () => void
  onRemove: () => void
  onToggleAll: () => void
  onAddSet: () => void
  onPickRpe: (rpe: number) => void
  onSwipe: (setId: string, open: boolean) => void
  onEditSet: (setId: string, opener: HTMLElement) => void
  onToggleSet: (set: Row) => void
  onDeleteSet: (setId: string) => void
}

function ExerciseCard(p: ExerciseCardProps) {
  const { item, index, sorting } = p
  const { entry, exercise, sets } = item
  const reduced = useReducedMotion()
  const allPress = usePressed()
  const name = exercise ? String(exercise.name) : '（已刪除的動作）'
  const group = exercise ? (MUSCLE_GROUP_LABEL[exercise.muscle_group as MuscleGroup] ?? '其他') : ''
  const tips = typeof exercise?.tips === 'string' ? exercise.tips.trim() : ''
  // 有圖的動作（目錄裡有圖的預設動作，含有氧的坡度健走；由 exerciseCatalog.test 鎖住）縮圖是獨立的放大鈕；沒圖的（自建、已刪除、
  // 資料集沒有對應的三個預設動作）肌群單字或類型圖示留在 ex-toggle 裡，點它仍是名稱鈕的動作，不留點不到的死區
  const photo = exercise != null && hasCatalogImage(exercise)
  // 有氧卡沒有組：永遠收合，名稱鈕改開有氧 sheet
  const cardio = isCardioCard(item)
  const open = !cardio && p.open && !sorting
  const tipsOpen = p.tipsOpen
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
        {/* 每張卡都有 ⓘ（沒寫過要點的是淡色，不隱藏）：隱藏會讓箭頭、ⓘ、⋯ 在各卡上對不齊 */}
        <button
          className={`tr-ib ex-info${tips ? '' : ' is-empty'}`}
          type="button"
          aria-expanded={tipsOpen}
          aria-label={tips ? `${name} 的要點` : `${name} 還沒有要點`}
          disabled={!exercise}
          onClick={p.onToggleTips}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
        </button>
        <Menu.Root>
          <Menu.Trigger className="tr-ib" aria-label={`${name} 的更多操作`}>
            <DotsIcon />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="ex-menu-pos" side="bottom" align="end" sideOffset={4} collisionPadding={12}>
              <Menu.Popup className="ex-menu">
                {exercise && (
                  <Menu.Item className="ex-menu-item" onClick={p.onEditTips}>
                    {tips ? '編輯要點' : '加要點'}
                  </Menu.Item>
                )}
                <Menu.Item className="ex-menu-item is-danger" onClick={p.onRemove}>
                  移除這個動作
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>

      {/* 排序中整段不掛 AnimatePresence：沒有退場動畫，收合在同一次 commit 完成。dnd-kit 在 beforedragstart 之後
          等 React 渲染完才量尺寸並凍結被拖那張的寬高，退場動畫還在跑的話量到的是展開時的高度 */}
      {!sorting && (
        <>
          <AnimatePresence initial={false}>
            {tipsOpen && (
              <motion.div
                key="tips"
                className="ex-tips-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={spring}
                style={{ overflow: 'hidden' }}
              >
                <div className="ex-tips-body">
                  {tips ? <p className="ex-tips-text">{tips}</p> : <p className="ex-tips-text is-empty">還沒有要點</p>}
                  <button className="ex-tips-edit" type="button" onClick={p.onEditTips}>
                    {tips ? '編輯要點' : '新增要點'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

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
          {/* 有氧卡沒有組，也就沒有「最後一組」可問；明確不掛，不靠 exerciseRpe([]) 剛好回「沒做完」 */}
          {!cardio && <RpeFooter name={name} sets={sets} show={p.showRpe} onPick={p.onPickRpe} />}
        </>
      )}
    </section>
  )
}

/* ═══════════ 整頁 ═══════════ */

export default function TrainingSession({ detail, db, onWrite, onBack }: TrainingSessionProps) {
  const { workout, exercises } = detail
  const inProgress = workout.ended_at == null
  const backfilled = isBackfilled(workout)
  const live = inProgress && !backfilled
  const now = useNow(live)
  // 組間休息：只在即時進行中的訓練啟動（補記與已結束的不啟動）；「全部完成」不啟動，只有單點勾組才算「剛做完一組」
  const rest = useRestTimer(String(workout.id), live)
  // RPE 問題（spec.md「階段 4 乙」）：每次勾組都重設——是這個動作的最後一組才問；picked 之後約 0.6 秒收起
  const [ask, setAsk] = useState<RpeAsk | null>(null)
  const askShown = ask !== null && rest.endAt !== null
  useEffect(() => {
    if (ask?.picked == null) return
    const t = setTimeout(() => setAsk(null), RPE_ASK_CLOSE_MS)
    return () => clearTimeout(t)
  }, [ask])

  // 一進來展開第一張重訓卡（有氧卡不展開）
  const [openEx, setOpenEx] = useState<string | null>(() => exercises.find((e) => !isCardioCard(e))?.entry.id ?? null)
  const [tipsOpenIds, setTipsOpenIds] = useState<ReadonlySet<string>>(new Set())
  const [swipeId, setSwipeId] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  // 目標與開關分開：關閉動畫期間表單不能跳成別的目標
  const [setTarget, setSetTarget] = useState<SetTarget | null>(null)
  const [setOpen, setSetOpen] = useState(false)
  const setOpener = useRef<HTMLElement | null>(null)
  const [tipsTarget, setTipsTarget] = useState<Row | null>(null)
  const [tipsOpen, setTipsOpen] = useState(false)
  // 有氧 sheet：記卡的 id、每次 render 從 detail 取那一列（存檔後卡片與下次打開都是新值）；session 當表單 key
  const [cardioId, setCardioId] = useState<string | null>(null)
  const [cardioOpen, setCardioOpen] = useState(false)
  const [cardioSession, setCardioSession] = useState(0)
  // 分鐘欄的「上次 N」：開 sheet 當下取一次（排除這次訓練），sheet 開著時不隨寫入變
  const [cardioLast, setCardioLast] = useState<number | null>(null)
  const [finish, setFinish] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [askRemove, setAskRemove] = useState<string | null>(null)
  // 移除確認的內文跟著問的當下記住：關閉時 askRemove 先清掉，照 removing 算的話收起途中會跳成重訓的文案
  const [removeCardio, setRemoveCardio] = useState(false)
  const [flash, setFlash] = useState<readonly string[]>([])
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reduced = useReducedMotion()
  const [cascade, setCascade] = useState<readonly string[]>([])
  const cascadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sorting, setSorting] = useState(false)
  // 放下後到寫入完成之間的顯示順序（entry id）；null＝照資料的順序
  const [pending, setPending] = useState<string[] | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
      if (cascadeTimer.current) clearTimeout(cascadeTimer.current)
    },
    [],
  )

  const run = useCallback(
    async (ops: RowOp[]): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        await onWrite(ops)
        return true
      } catch (e) {
        setError(`這筆沒有存下來：${errText(e)}`)
        return false
      } finally {
        setBusy(false)
      }
    },
    [onWrite],
  )

  const summary = workoutSummary(
    setsOfDetail(detail),
    String(workout.started_at),
    inProgress ? null : String(workout.ended_at),
    now,
  )
  const timeText =
    backfilled && inProgress ? '—' : live ? clock(now.getTime() - Date.parse(String(workout.started_at))) : `${summary.minutes} 分`

  const addExercise = async (exerciseId: string) => {
    const ops = addExerciseOps({ db, workoutId: workout.id, exerciseId, newId })
    if (await run(ops)) {
      setPicker(false)
      // 有氧卡不展開：剛加的是有氧就維持目前展開的那張，不把它收起來
      if (!isCardioExercise(db.exercises.find((e) => e.id === exerciseId))) setOpenEx(ops[0].rowId)
    }
  }

  // 只有有氧動作的卡能開：checkCardio 對非有氧回「請選有氧類型」，而這張 sheet 沒有類型可選
  const openCardio = (item: WorkoutExerciseDetail) => {
    if (!isCardioCard(item)) return
    setCardioId(item.entry.id)
    setCardioLast(cardioLastMinutes(db, String(item.entry.exercise_id), workout.id))
    setCardioSession((n) => n + 1)
    setCardioOpen(true)
  }
  const cardioItem = cardioId ? exercises.find((e) => e.entry.id === cardioId) : undefined

  const finishNow = async (minutes: number | null) => {
    let ops: RowOp[]
    try {
      ops = finishWorkoutOps({ workout, now: new Date(), minutes })
    } catch (e) {
      setError(errText(e))
      return
    }
    if (await run(ops)) {
      setFinish(false)
      onBack()
    }
  }

  const saveRoutine = (name: string) =>
    run(routineFromWorkoutOps({ db, workoutId: workout.id, name, newId }))

  const removeExercise = async (entryId: string) => {
    setAskRemove(null)
    setAsk(null) // 問題列問的那一組可能就在這個動作裡
    await run([{ op: 'delete', table: 'workout_exercises', rowId: entryId }])
  }

  const reorder = async (orderedIds: string[]) => {
    try {
      const ops = reorderWorkoutExercisesOps({ entries: exercises.map((e) => e.entry), orderedIds })
      if (ops.length === 0) return
      setPending(orderedIds)
      await run(ops)
    } catch (e) {
      setError(`這筆沒有存下來：${errText(e)}`)
    } finally {
      setPending(null)
    }
  }

  const showFlash = (ids: string[]) => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlash(ids)
    flashTimer.current = setTimeout(() => setFlash([]), 700 + ids.length * 50)
  }

  // 全部完成：資料一次寫入，畫面由上往下逐組換（每組錯開 CASCADE_STEP_MS）。class 不能晚於 done 的變動才掛上
  // （transition 建立當下就取 transition-delay），所以先 set、再寫入；寫入落地後才開始倒數收掉，
  // 慢的寫入（離線佇列、跨分頁鎖）不會讓 class 在 done 變動之前就被收走。進行中再按：新一輪從畫面當前狀態接續。
  // 減少動態不逐組錯開，全部同時換。
  const endCascade = () => {
    if (cascadeTimer.current) clearTimeout(cascadeTimer.current)
    cascadeTimer.current = null
    setCascade([])
  }
  const toggleAll = async (entryId: string) => {
    const ops = toggleAllDoneOps(detail, entryId)
    const staggered = !reduced && ops.length > 1
    if (staggered) {
      if (cascadeTimer.current) clearTimeout(cascadeTimer.current)
      setCascade(ops.map((o) => o.rowId))
    }
    await run(ops)
    if (!staggered) return
    if (cascadeTimer.current) clearTimeout(cascadeTimer.current)
    cascadeTimer.current = setTimeout(() => setCascade([]), DUR.base + 200 + ops.length * CASCADE_STEP_MS)
  }

  const finishLines: FinishLine[] = exercises.map((item) => ({
    name: item.exercise ? String(item.exercise.name) : '（已刪除的動作）',
    // 有氧卡沒有組：列有氧摘要；沒填分鐘時給「還沒填」，不落到 FinishSheet 的「沒有打勾的組」
    text: isCardioCard(item)
      ? cardioSummary(item.entry) || '還沒填'
      : item.sets
          .filter((s) => s.done === true)
          .map((s) => `${formatKg(Number(s.weight_kg))} × ${Number(s.reps)}`)
          .join(' · '),
  }))

  const pickable = db.exercises.filter((e) => e.archived !== true)
  const removing = askRemove ? exercises.find((e) => e.entry.id === askRemove) : undefined
  const shown = pending ? pending.flatMap((id) => exercises.filter((e) => e.entry.id === id)) : exercises

  // 會丟掉已記的東西才先問：重訓是打過勾的組，有氧是填過的分鐘
  const askRemoveExercise = (item: WorkoutExerciseDetail) => {
    const cardio = isCardioCard(item)
    const recorded = cardio ? cardioRecorded(item.entry) : item.sets.some((s) => s.done === true)
    if (recorded) {
      setRemoveCardio(cardio)
      setAskRemove(item.entry.id)
    } else void removeExercise(item.entry.id)
  }

  return (
    <div className={`main${rest.endAt !== null ? ' has-rest' : ''}${askShown ? ' has-rest-ask' : ''}`} data-screen="training-session" data-workout-id={workout.id}>
      <header className="tr-top">
        <button className="tr-ib" type="button" aria-label={inProgress ? '返回（訓練繼續進行）' : '返回'} onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <h1>{inProgress ? '訓練中' : '訓練紀錄'}</h1>
        <button className="tr-ib" type="button" aria-label="刪除這次訓練" onClick={() => setAskDelete(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
          </svg>
        </button>
      </header>

      <div className="tr-stats" aria-live="polite">
        <div className="tr-stat">
          <span className="v" data-stat="time">
            {timeText}
          </span>
          <span className="l">時長</span>
        </div>
        <div className="tr-stat">
          <span className="v" data-stat="volume">
            <Flip text={summary.volume.toLocaleString('en-US')} ms={DUR.base} />
          </span>
          <span className="l">訓練量 kg</span>
        </div>
        <div className="tr-stat">
          <span className="v" data-stat="sets">
            <Flip text={`${summary.doneSets}/${summary.totalSets}`} ms={DUR.base} />
          </span>
          <span className="l">完成組數</span>
        </div>
      </div>

      {error && (
        <div className="tr-status is-error" role="alert">
          <span className="grow">{error}</span>
        </div>
      )}

      <div className={`tr-scroll${sorting ? ' is-sorting' : ''}`}>
        {exercises.length === 0 && <p className="muted">還沒有動作，按下面的「加動作」開始</p>}
        <DragDropProvider
          plugins={(defaults) => [...defaults, sortableAccessibility]}
          modifiers={[rubberBandToElement(() => listRef.current)]}
          onBeforeDragStart={() => {
            setSorting(true)
            setSwipeId(null)
          }}
          onDragEnd={(event) => {
            setSorting(false)
            if (event.canceled) return
            void reorder(move(shown.map((e) => e.entry.id), event))
          }}
        >
          <div className="tr-cards" ref={listRef}>
            {shown.map((item, index) => (
              <ExerciseCard
                key={item.entry.id}
                item={item}
                showRpe={live}
                index={index}
                open={openEx === item.entry.id}
                tipsOpen={tipsOpenIds.has(item.entry.id)}
                sorting={sorting}
                swipeId={swipeId}
                flash={flash}
                cascade={cascade}
                onToggleOpen={() => {
                  setOpenEx(openEx === item.entry.id ? null : item.entry.id)
                  setSwipeId(null)
                }}
                onOpenCardio={() => {
                  setSwipeId(null)
                  openCardio(item)
                }}
                onToggleTips={() =>
                  setTipsOpenIds((cur) => {
                    const next = new Set(cur)
                    if (next.has(item.entry.id)) next.delete(item.entry.id)
                    else next.add(item.entry.id)
                    return next
                  })
                }
                onEditTips={() => {
                  if (!item.exercise) return
                  setTipsTarget(item.exercise)
                  setTipsOpen(true)
                }}
                onRemove={() => askRemoveExercise(item)}
                onToggleAll={() => {
                  if (item.sets.some((x) => x.id === ask?.setId)) setAsk(null) // 全部完成／取消全部完成都不再問（沒有「剛做完一組」的語意）
                  void toggleAll(item.entry.id)
                }}
                onPickRpe={(rpe) => {
                  // 休息條正問著這個動作的同一題：在頁尾答了，條上那題也跟著標已答、走同一條 0.6 秒收起的路
                  if (ask && ask.picked === null && item.sets.some((x) => x.id === ask.setId)) setAsk({ ...ask, picked: rpe })
                  void run(setExerciseRpeOps(item.sets, rpe))
                }}
                onAddSet={() => {
                  if (item.sets.some((x) => x.id === ask?.setId)) setAsk(null) // 多了一組沒做的，這個動作就不算做完了
                  void run(addSetOps({ db, workoutExerciseId: item.entry.id, newId }))
                }}
                onSwipe={(setId, o) => setSwipeId(o ? setId : swipeId === setId ? null : swipeId)}
                onEditSet={(setId, opener) => {
                  setSwipeId(null)
                  setOpener.current = opener
                  setSetTarget({ entryId: item.entry.id, setId })
                  setSetOpen(true)
                }}
                onToggleSet={(s) => {
                  endCascade() // 逐組進行中單點一組：不該被逐組的延遲拖慢；已經起跑的其他列不受影響
                  if (s.done === true && item.sets.some((x) => x.id === ask?.setId)) setAsk(null) // 取消勾：這個動作不算做完了，不再問
                  if (s.done !== true) {
                    rest.start() // 未完成→完成才起算；放在寫入之前，iOS 才認它是使用者手勢（解鎖提示音）
                    setAsk(completesExercise(item.sets, s.id) && exerciseRpe(item.sets).rpe === null ? { setId: s.id, picked: null } : null)
                  }
                  void run([{ op: 'update', table: 'workout_sets', rowId: s.id, payload: { done: s.done !== true } }])
                }}
                onDeleteSet={(setId) => {
                  setSwipeId(null)
                  if (ask?.setId === setId) setAsk(null)
                  void run(removeSetOps(detail, setId))
                }}
              />
            ))}
          </div>
        </DragDropProvider>
        <GymVisualCredit exercises={shown.map((e) => e.exercise)} />
      </div>

      <div className="tr-bottom">
        <RestBar
          timer={rest}
          ask={askShown ? ask : null}
          onPick={(rpe) => {
            if (!ask || ask.picked !== null) return
            setAsk({ ...ask, picked: rpe })
            const entrySets = exercises.find((e) => e.sets.some((s) => s.id === ask.setId))?.sets ?? []
            void run(setExerciseRpeOps(entrySets, rpe))
          }}
        />
        <button className="tr-secondary" type="button" onClick={() => setPicker(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          加動作
        </button>
        <button className="action-btn" type="button" onClick={() => (inProgress ? setFinish(true) : onBack())}>
          {inProgress ? '完成訓練' : '完成'}
        </button>
      </div>

      <ExercisePicker open={picker} exercises={pickable} onClose={() => setPicker(false)} onPick={(id) => void addExercise(id)} />

      <SetSheet
        open={setOpen}
        onClose={() => setSetOpen(false)}
        target={setTarget}
        detail={detail}
        db={db}
        run={run}
        finalFocus={setOpener}
        onSynced={showFlash}
        onDeleted={() => {
          if (ask?.setId === setTarget?.setId) setAsk(null)
          // 這一組已經不在了：關閉後焦點落到那張卡的名稱鈕
          setOpener.current = document.querySelector<HTMLElement>(`[data-entry-id="${setTarget?.entryId}"] .ex-toggle`)
        }}
      />

      <CardioSheet
        open={cardioOpen}
        entry={cardioItem?.entry ?? null}
        exercise={cardioItem?.exercise ?? null}
        lastMinutes={cardioLast}
        session={cardioSession}
        onClose={() => setCardioOpen(false)}
        onWrite={onWrite}
      />

      <ExerciseEditSheet
        open={tipsOpen}
        exercise={tipsTarget}
        exercises={db.exercises}
        onClose={() => setTipsOpen(false)}
        onWrite={onWrite}
      />

      <FinishSheet
        open={finish}
        volume={summary.volume}
        minutes={backfilled ? null : summary.minutes}
        doneSets={summary.doneSets}
        totalSets={summary.totalSets}
        lines={finishLines}
        backfill={backfilled}
        canSaveRoutine={workout.routine_id == null && exercises.length > 0}
        busy={busy}
        error={error}
        onClose={() => setFinish(false)}
        onFinish={(m) => void finishNow(m)}
        onSaveRoutine={saveRoutine}
      />

      <ConfirmDialog
        open={askDelete}
        title="刪除這次訓練？"
        cancelLabel="先不要"
        confirmLabel="刪除"
        danger
        onCancel={() => setAskDelete(false)}
        onConfirm={() => {
          setAskDelete(false)
          void run([{ op: 'delete', table: 'workouts', rowId: workout.id }]).then((ok) => ok && onBack())
        }}
      >
        <p>這次訓練的所有動作與組都會刪掉，找不回來。</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== undefined}
        title="移除這個動作？"
        cancelLabel="先不要"
        confirmLabel="移除"
        danger
        onCancel={() => setAskRemove(null)}
        onConfirm={() => removing && void removeExercise(removing.entry.id)}
      >
        <p>{removeCardio ? '這張卡記下的有氧會一起刪掉。' : '這個動作已經打勾的組會一起刪掉。'}</p>
      </ConfirmDialog>
    </div>
  )
}
