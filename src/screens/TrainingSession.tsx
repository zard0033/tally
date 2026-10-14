/* 訓練中的整頁（樣張 ③）：一次訓練的所有動作與組，記組、打勾、調整、加動作、完成。
   同一頁也用來重新打開已結束的訓練編輯（AC 8）：修改當下就存，不需要再按儲存。

   寫入全部走 onWrite（排進離線佇列、立刻反映在畫面上）。輸入框用「草稿」：打字途中不寫，
   失焦或按 Enter 才寫一筆——每個按鍵都寫會讓佇列與 IndexedDB 每秒被寫幾次。± 與打勾是單一動作，
   當下就寫。不合法的輸入（負數、超過 DDL 的上限）不寫、放回原值，不靜默截斷成別的數字。 */
import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import ExercisePicker from './ExercisePicker'
import FinishSheet, { type FinishLine } from './FinishSheet'
import {
  MUSCLE_GROUP_LABEL,
  addExerciseOps,
  addSetOps,
  finishWorkoutOps,
  formatKg,
  formatLastSets,
  isBackfilled,
  lastCompletedSets,
  setsOfDetail,
  workoutSummary,
  type MuscleGroup,
  type Row,
  type RowOp,
  type TrainingDb,
  type WorkoutDetail,
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

const round2 = (n: number) => Math.round(n * 100) / 100
const parseWeight = (raw: string): number | null => {
  const n = Number(raw.trim().replace(',', '.'))
  return raw.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 1000 ? round2(n) : null
}
const parseReps = (raw: string): number | null => {
  const n = Number(raw.trim())
  return raw.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 999 ? n : null
}

/* ═══════════ 一組 ═══════════ */

interface SetRowProps {
  set: Row
  no: number
  active: boolean
  onActivate: () => void
  onPatch: (patch: Record<string, unknown>) => void
}

function SetRow({ set, no, active, onActivate, onPatch }: SetRowProps) {
  const weight = Number(set.weight_kg)
  const reps = Number(set.reps)
  const done = set.done === true
  // null＝顯示已存的值；有字串＝使用者正在打、還沒寫
  const [dw, setDw] = useState<string | null>(null)
  const [dr, setDr] = useState<string | null>(null)

  const curWeight = (dw !== null ? parseWeight(dw) : null) ?? weight
  const curReps = (dr !== null ? parseReps(dr) : null) ?? reps

  /** 把草稿換算成要寫的欄位；不合法的草稿直接丟掉（放回原值）。 */
  const draftPatch = (): Record<string, unknown> => {
    const patch: Record<string, unknown> = {}
    if (dw !== null) {
      const v = parseWeight(dw)
      if (v !== null && v !== weight) patch.weight_kg = v
    }
    if (dr !== null) {
      const v = parseReps(dr)
      if (v !== null && v !== reps) patch.reps = v
    }
    return patch
  }
  const flush = (extra: Record<string, unknown> = {}) => {
    const patch = { ...draftPatch(), ...extra }
    setDw(null)
    setDr(null)
    if (Object.keys(patch).length > 0) onPatch(patch)
  }

  const step = (field: 'weight_kg' | 'reps', delta: number) => {
    if (field === 'weight_kg') flush({ weight_kg: Math.min(1000, Math.max(0, round2(curWeight + delta))) })
    else flush({ reps: Math.min(999, Math.max(0, curReps + delta)) })
  }

  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  return (
    <>
      <div className={`set${done ? ' done' : ''}${active ? ' active' : ''}`} data-set-id={set.id}>
        <span className="no">{no}</span>
        <input
          className="tr-in w"
          type="text"
          inputMode="decimal"
          value={dw ?? formatKg(weight)}
          aria-label={`第 ${no} 組重量 kg`}
          onFocus={onActivate}
          onChange={(e) => setDw(e.target.value)}
          onBlur={() => flush()}
          onKeyDown={onEnter}
        />
        <input
          className="tr-in r"
          type="text"
          inputMode="numeric"
          value={dr ?? String(reps)}
          aria-label={`第 ${no} 組次數`}
          onFocus={onActivate}
          onChange={(e) => setDr(e.target.value)}
          onBlur={() => flush()}
          onKeyDown={onEnter}
        />
        <button
          className="tr-check"
          type="button"
          aria-pressed={done}
          aria-label={`第 ${no} 組完成`}
          onClick={() => flush({ done: !done })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </button>
      </div>
      {active && (
        <div className="adj" role="group" aria-label={`第 ${no} 組調整`}>
          <div className="adj-line" role="group" aria-label="重量 kg">
            {[-5, -2.5].map((d) => (
              <button key={d} className="adj-b" type="button" aria-label={`重量減 ${-d} 公斤`} onClick={() => step('weight_kg', d)}>
                −{-d}
              </button>
            ))}
            <output className="adj-v">{formatKg(curWeight)} kg</output>
            {[2.5, 5].map((d) => (
              <button key={d} className="adj-b" type="button" aria-label={`重量加 ${d} 公斤`} onClick={() => step('weight_kg', d)}>
                +{d}
              </button>
            ))}
          </div>
          <div className="adj-line" role="group" aria-label="次數">
            {[-5, -1].map((d) => (
              <button key={d} className="adj-b" type="button" aria-label={`次數減 ${-d}`} onClick={() => step('reps', d)}>
                −{-d}
              </button>
            ))}
            <output className="adj-v">{curReps} 次</output>
            {[1, 5].map((d) => (
              <button key={d} className="adj-b" type="button" aria-label={`次數加 ${d}`} onClick={() => step('reps', d)}>
                +{d}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/* ═══════════ 整頁 ═══════════ */

export default function TrainingSession({ detail, db, onWrite, onBack }: TrainingSessionProps) {
  const { workout, exercises } = detail
  const inProgress = workout.ended_at == null
  const backfilled = isBackfilled(workout)
  const live = inProgress && !backfilled
  const now = useNow(live)

  const [openEx, setOpenEx] = useState<string | null>(() => exercises[0]?.entry.id ?? null)
  const [activeSet, setActiveSet] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [finish, setFinish] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [askRemove, setAskRemove] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      setOpenEx(ops[0].rowId)
    }
  }

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

  const removeExercise = async (entryId: string) => {
    setAskRemove(null)
    await run([{ op: 'delete', table: 'workout_exercises', rowId: entryId }])
  }

  const finishLines: FinishLine[] = exercises.map(({ exercise, sets }) => ({
    name: exercise ? String(exercise.name) : '（已刪除的動作）',
    text: sets
      .filter((s) => s.done === true)
      .map((s) => `${formatKg(Number(s.weight_kg))} × ${Number(s.reps)}`)
      .join(' · '),
  }))

  const pickable = db.exercises.filter((e) => e.archived !== true)
  const removing = askRemove ? exercises.find((e) => e.entry.id === askRemove) : undefined

  return (
    <div className="main" data-screen="training-session" data-workout-id={workout.id}>
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
            {summary.volume.toLocaleString('en-US')}
          </span>
          <span className="l">訓練量 kg</span>
        </div>
        <div className="tr-stat">
          <span className="v" data-stat="sets">
            {summary.doneSets}/{summary.totalSets}
          </span>
          <span className="l">完成組數</span>
        </div>
      </div>

      {error && (
        <div className="tr-status is-error" role="alert">
          <span className="grow">{error}</span>
        </div>
      )}

      <div className="tr-scroll">
        {exercises.length === 0 && <p className="muted">還沒有動作，按下面的「加動作」開始</p>}
        {exercises.map(({ entry, exercise, sets }) => {
          const open = openEx === entry.id
          const name = exercise ? String(exercise.name) : '（已刪除的動作）'
          const group = exercise ? (MUSCLE_GROUP_LABEL[exercise.muscle_group as MuscleGroup] ?? '其他') : ''
          const last = formatLastSets(lastCompletedSets(db, String(entry.exercise_id), workout.id))
          const sub = [group, open ? null : `${sets.length} 組`, last ? `上次 ${last}` : null].filter(Boolean).join(' · ')
          const tips = typeof exercise?.tips === 'string' ? exercise.tips.trim() : ''
          return (
            <section key={entry.id} className={`tr-card ex${open ? '' : ' collapsed'}`} aria-label={name} data-entry-id={entry.id}>
              <button
                className="ex-head"
                type="button"
                aria-expanded={open}
                onClick={() => {
                  setOpenEx(open ? null : entry.id)
                  setActiveSet(null)
                }}
              >
                <span className="grow">
                  <span className="nm">{name}</span>
                  <span className="sub">{sub}</span>
                </span>
                <svg className={`chev${open ? ' is-open' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
              {open && (
                <>
                  {tips && (
                    <div className="ex-tips">
                      <span className="t">要點</span>
                      {tips}
                    </div>
                  )}
                  <div className="set-head" aria-hidden="true">
                    <span>組</span>
                    <span>重量 kg</span>
                    <span>次數</span>
                    <span>完成</span>
                  </div>
                  {sets.map((s, i) => (
                    <SetRow
                      key={s.id}
                      set={s}
                      no={i + 1}
                      active={activeSet === s.id}
                      onActivate={() => setActiveSet(s.id)}
                      onPatch={(patch) => void run([{ op: 'update', table: 'workout_sets', rowId: s.id, payload: patch }])}
                    />
                  ))}
                  <button
                    className="tr-text-btn"
                    type="button"
                    onClick={() => void run(addSetOps({ db, workoutExerciseId: entry.id, newId }))}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    新增一組
                  </button>
                  <button
                    className="tr-text-btn is-quiet"
                    type="button"
                    onClick={() => {
                      if (sets.some((s) => s.done === true)) setAskRemove(entry.id)
                      else void removeExercise(entry.id)
                    }}
                  >
                    移除這個動作
                  </button>
                </>
              )}
            </section>
          )
        })}
      </div>

      <div className="tr-bottom">
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

      <FinishSheet
        open={finish}
        volume={summary.volume}
        minutes={backfilled ? null : summary.minutes}
        doneSets={summary.doneSets}
        totalSets={summary.totalSets}
        lines={finishLines}
        backfill={backfilled}
        busy={busy}
        error={error}
        onClose={() => setFinish(false)}
        onFinish={(m) => void finishNow(m)}
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
        <p>這個動作已經打勾的組會一起刪掉。</p>
      </ConfirmDialog>
    </div>
  )
}
