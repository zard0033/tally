/* 訓練中的整頁：一次訓練的所有動作與組，記組、打勾、調整、加動作、排序、完成。
   同一頁也用來重新打開已結束的訓練編輯（AC 8）：修改當下就存，不需要再按儲存。

   組的重量與次數不在列上打字：點它開「組編輯 sheet」（SetSheet，± 與大數字都在那裡，每次立即寫入）。
   列上只有兩顆數字鈕與一顆勾；整列可左滑露出紅鈕刪除。卡片頭固定幾件事：握把、名稱（點了收合／展開）、
   替換（點了開 picker 換成另一個動作，位置不動）、移除；收合時第二行是進度（圓點＋下一組），展開時是肌群；
   展開的卡頂部是要點條（TipsStrip）：點一下原地寫，失焦才存。
   欄頭的雙勾是「全部完成」。排序只能從握把拖（@dnd-kit/react），拖起時所有卡收合、範圍限制在清單區內並有橡皮筋。
   有氧動作的卡（spec「有氧併入動作」）沒有組：永遠是收合的外觀，名稱鈕點了開有氧 sheet（CardioSheet），第二行是摘要或「點一下填寫」；
   沒有組列、全部完成、新增一組，勾組才會觸發的休息條與重量建議也就碰不到。握把、替換、移除與其他卡相同。
   有氧動作卻有組的卡退回重訓的畫法（`isCardioCard`）。
   寫入全部走 onWrite（排進離線佇列、立刻反映在畫面上）。詳見 spec.md「訓練中畫面改版」。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { DragDropProvider } from '@dnd-kit/react'
import { move } from '@dnd-kit/helpers'
import EmptyNote from '@/components/EmptyNote'
import ConfirmDialog from '@/components/ConfirmDialog'
import Flip from '@/components/Flip'
import GymVisualCredit from '@/components/GymVisualCredit'
import RestBar, { type RpeAsk } from '@/components/RestBar'
import { useRestTimer } from '@/components/useRestTimer'
import { usePendingOrder } from '@/components/usePendingOrder'
import { rubberBandToElement } from '@/components/rubberBandModifier'
import { sortableAccessibility } from '@/components/sortableA11y'
import { CASCADE_STEP_MS, DUR, RPE_ASK_CLOSE_MS } from '@/lib/durations'
import CardioSheet from './CardioSheet'
import ExerciseCard from './ExerciseCard'
import ExercisePicker from './ExercisePicker'
import FinishSheet, { type FinishLine } from './FinishSheet'
import SetSheet, { type SetTarget } from './SetSheet'
import {
  addExerciseOps,
  addSetOps,
  cardioLastMinutes,
  cardioSummary,
  completesExercise,
  entryHasRecord,
  exerciseDisplayName,
  finishWorkoutOps,
  formatKg,
  isBackfilled,
  isCardioCard,
  isCardioExercise,
  lastSetRpe,
  removeSetOps,
  replaceExerciseOps,
  reorderWorkoutExercisesOps,
  routineFromWorkoutOps,
  setLastSetRpeOps,
  setsOfDetail,
  toggleAllDoneOps,
  updateExerciseOps,
  withPendingDone,
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
  // 在組編輯 sheet 填了這個動作最後一組的 RPE：休息條上同一題跟著標已答（走同一條 0.6 秒收起的路），免得兩個入口各說各話
  useEffect(() => {
    if (!ask || ask.picked !== null) return
    const entry = exercises.find((e) => e.sets.some((s) => s.id === ask.setId))
    const rpe = entry ? lastSetRpe(entry.sets).rpe : null
    if (rpe !== null) setAsk({ ...ask, picked: rpe })
  }, [ask, exercises])

  // 一進來展開第一張重訓卡（有氧卡不展開）
  const [openEx, setOpenEx] = useState<string | null>(() => exercises.find((e) => !isCardioCard(e))?.entry.id ?? null)
  const [swipeId, setSwipeId] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  // 替換：要換的那張卡（entry id）。跟 picker 的開關分開，關閉動畫期間標題與清單不能跳回「加動作」
  const [replacing, setReplacing] = useState<string | null>(null)
  // 被換掉的那個動作（exercise id）：舊卡寫入成功後就不在 exercises 裡了，picker 收起的那段時間清單還要把它排除
  const [replacingExercise, setReplacingExercise] = useState<string | null>(null)
  // 舊動作有記下的東西時，先問再開 picker（取消不花任何東西）；cardio 決定內文
  const [askReplace, setAskReplace] = useState<{ entryId: string; exerciseId: string } | null>(null)
  // 確認框的內文跟著問的當下記住（同 removeCardio／removeRecorded）：關閉時 askReplace 先清掉，照它算會在收起途中跳成重訓的文案
  const [replaceCardio, setReplaceCardio] = useState(false)
  // 目標與開關分開：關閉動畫期間表單不能跳成別的目標
  const [setTarget, setSetTarget] = useState<SetTarget | null>(null)
  const [setOpen, setSetOpen] = useState(false)
  const setOpener = useRef<HTMLElement | null>(null)
  // 有氧 sheet：記卡的 id、每次 render 從 detail 取那一列（存檔後卡片與下次打開都是新值）
  const [cardioId, setCardioId] = useState<string | null>(null)
  const [cardioOpen, setCardioOpen] = useState(false)
  // 分鐘欄的「上次 N」：開 sheet 當下取一次（排除這次訓練），sheet 開著時不隨寫入變
  const [cardioLast, setCardioLast] = useState<number | null>(null)
  const [finish, setFinish] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [askRemove, setAskRemove] = useState<string | null>(null)
  // 移除確認的內文跟著問的當下記住：關閉時 askRemove 先清掉，照 removing 算的話收起途中會跳成重訓的文案
  const [removeCardio, setRemoveCardio] = useState(false)
  const [removeRecorded, setRemoveRecorded] = useState(false)
  const [flash, setFlash] = useState<readonly string[]>([])
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reduced = useReducedMotion()
  const [cascade, setCascade] = useState<readonly string[]>([])
  const cascadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sorting, setSorting] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  /* 已送出、還沒落地的勾（setId → done）：判斷「這是不是這個動作的最後一組、要不要問 RPE」時一起算，見 withPendingDone */
  const pendingDone = useRef(new Map<string, { done: boolean; token: symbol }>())
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

  // 要點條就地存：只送 tips 這一欄（名稱與肌群原樣帶進去，updateExerciseOps 只會留下有變的欄位）
  const saveTips = (exercise: Row, tips: string) => {
    const t = tips.trim()
    const ops = updateExerciseOps({
      current: exercise,
      value: { name: String(exercise.name), muscle_group: exercise.muscle_group as MuscleGroup, tips: t === '' ? null : t },
    })
    return ops.length === 0 ? Promise.resolve(true) : run(ops)
  }

  const replaceExercise = async (entryId: string, exerciseId: string) => {
    const item = exercises.find((e) => e.entry.id === entryId)
    if (!item) return
    const ops = replaceExerciseOps({ db, workoutId: workout.id, entry: item.entry, exerciseId, newId })
    if (await run(ops)) {
      setPicker(false)
      setAsk(null) // 問題列問的那一組可能就在被換掉的動作裡（同 removeExercise）
      // 同 addExercise：新的是有氧就不展開；舊的那張原本展開著就不能再指向已經不在的 id
      if (!isCardioExercise(db.exercises.find((e) => e.id === exerciseId))) setOpenEx(ops[1].rowId)
      else if (openEx === entryId) setOpenEx(null)
    }
  }

  // 替換只在會丟掉已記的東西時才先問（移除則一律先問，見 askRemoveExercise）；沒記東西就直接開 picker
  const startReplace = (item: WorkoutExerciseDetail) => {
    const cardio = isCardioCard(item)
    const recorded = entryHasRecord(item)
    setSwipeId(null)
    const exerciseId = String(item.entry.exercise_id)
    if (recorded) {
      setReplaceCardio(cardio)
      setAskReplace({ entryId: item.entry.id, exerciseId })
    } else openReplacePicker(item.entry.id, exerciseId)
  }
  const openReplacePicker = (entryId: string, exerciseId: string) => {
    setReplacing(entryId)
    setReplacingExercise(exerciseId)
    setPicker(true)
  }

  const openCardio = (item: WorkoutExerciseDetail) => {
    setCardioId(item.entry.id)
    setCardioLast(cardioLastMinutes(db, String(item.entry.exercise_id), workout.id))
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

  const { shown, reorder } = usePendingOrder({
    items: exercises,
    buildOps: (orderedIds) => reorderWorkoutExercisesOps({ entries: exercises.map((e) => e.entry), orderedIds }),
    run,
    onError: (e) => setError(`這筆沒有存下來：${errText(e)}`),
  })

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
    name: exerciseDisplayName(item.exercise),
    // 有氧卡沒有組：列有氧摘要；沒填分鐘時給「還沒填」，不落到 FinishSheet 的「沒有打勾的組」
    text: isCardioCard(item)
      ? cardioSummary(item.entry) || '還沒填'
      : item.sets
          .filter((s) => s.done === true)
          .map((s) => `${formatKg(Number(s.weight_kg))} × ${Number(s.reps)}`)
          .join(' · '),
  }))

  const pickable = db.exercises.filter((e) => e.archived !== true)
  // 替換時清單不放目前這個動作（換成自己沒有意義）
  const replacePickable = replacing ? pickable.filter((e) => e.id !== replacingExercise) : pickable
  const removing = askRemove ? exercises.find((e) => e.entry.id === askRemove) : undefined

  // 移除一律先問（卡片頭的移除鈕常駐、沒有 undo）；內文依有沒有記下東西分三種：重訓是打過勾的組，有氧是填過的分鐘，都沒有就只說會移除
  const askRemoveExercise = (item: WorkoutExerciseDetail) => {
    const cardio = isCardioCard(item)
    setRemoveCardio(cardio)
    setRemoveRecorded(entryHasRecord(item))
    setAskRemove(item.entry.id)
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
        <button className="tr-ib is-danger" type="button" aria-label="刪除這次訓練" onClick={() => setAskDelete(true)}>
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
        {exercises.length === 0 && <EmptyNote art="dumbbell">還沒有動作，按下面的「加動作」開始</EmptyNote>}
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
                index={index}
                open={openEx === item.entry.id}
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
                onReplace={() => startReplace(item)}
                onSaveTips={saveTips}
                onRemove={() => askRemoveExercise(item)}
                onToggleAll={() => {
                  if (item.sets.some((x) => x.id === ask?.setId)) setAsk(null) // 全部完成／取消全部完成都不再問（沒有「剛做完一組」的語意）
                  void toggleAll(item.entry.id)
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
                    rest.start() // 未完成→完成才起算
                    const sets = withPendingDone(item.sets, new Map([...pendingDone.current].map(([id, p]) => [id, p.done])))
                    setAsk(completesExercise(sets, s.id) && lastSetRpe(sets).rpe === null ? { setId: s.id, picked: null } : null)
                  }
                  // 每一下各帶一個 token：同一組連點兩下時，第一筆寫完不能把第二筆還在路上的紀錄刪掉
                  const token = Symbol()
                  pendingDone.current.set(s.id, { done: s.done !== true, token })
                  void run([{ op: 'update', table: 'workout_sets', rowId: s.id, payload: { done: s.done !== true } }]).finally(() => {
                    if (pendingDone.current.get(s.id)?.token === token) pendingDone.current.delete(s.id)
                  })
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
            void run(setLastSetRpeOps(entrySets, rpe))
          }}
        />
        <button
          className="tr-secondary"
          type="button"
          onClick={() => {
            setReplacing(null)
            setPicker(true)
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          加動作
        </button>
        <button className="action-btn" type="button" onClick={() => (inProgress ? setFinish(true) : onBack())}>
          {inProgress ? '完成訓練' : '完成'}
        </button>
      </div>

      <ExercisePicker
        open={picker}
        title={replacing ? '替換為…' : '加動作'}
        exercises={replacePickable}
        allExercises={db.exercises}
        onWrite={onWrite}
        onClose={() => setPicker(false)}
        onPick={(id) => void (replacing ? replaceExercise(replacing, id) : addExercise(id))}
      />

      <SetSheet
        open={setOpen}
        onClose={() => {
          // 從 RPE 標籤開的 sheet、在裡面把 RPE 取消，標籤已卸載：焦點改回同一列的重量鈕
          if (!setOpener.current?.isConnected) setOpener.current = document.querySelector<HTMLElement>(`[data-set-id="${setTarget?.setId}"] .tr-val.w`)
          setSetOpen(false)
        }}
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
        onClose={() => setCardioOpen(false)}
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
        open={askReplace !== null}
        title="替換這個動作？"
        cancelLabel="先不要"
        confirmLabel="繼續"
        danger
        onCancel={() => setAskReplace(null)}
        onConfirm={() => {
          const target = askReplace
          setAskReplace(null)
          if (target) openReplacePicker(target.entryId, target.exerciseId)
        }}
      >
        <p>{replaceCardio ? '換掉之後，這張卡記下的有氧會一起刪掉。' : '換掉之後，這個動作已經打勾的組會一起刪掉。'}</p>
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
        <p>
          {!removeRecorded
            ? '這個動作會從這次訓練移除。'
            : removeCardio
              ? '這張卡記下的有氧會一起刪掉。'
              : '這個動作已經打勾的組會一起刪掉。'}
        </p>
      </ConfirmDialog>
    </div>
  )
}
