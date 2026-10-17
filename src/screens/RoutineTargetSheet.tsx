/* 課表動作的預設組次 sheet：組數（必填）、次數（選填）。
   這兩個值只在該動作從沒做過時才用；有歷史就一律取上次實際完成的值（AC 5）。課表不存重量。
   entry 為 null＝關著。表單以 entry id 當 key，每次打開都是新的草稿。 */
import { useState } from 'react'
import SpringSheet from '@/components/SpringSheet'
import {
  MAX_TARGET_REPS,
  MAX_TARGET_SETS,
  checkRoutineTarget,
  updateRoutineExerciseTargetOps,
  type Row,
  type RowOp,
} from '@/lib/training'

interface RoutineTargetSheetProps {
  open: boolean
  /** routine_exercises 那一列；關閉動畫期間仍保留，標題不會跳掉。 */
  entry: Row | null
  exerciseName: string
  onClose: () => void
  onWrite: (ops: RowOp[]) => Promise<void>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function TargetForm({ entry, onClose, onWrite }: Pick<RoutineTargetSheetProps, 'onClose' | 'onWrite'> & { entry: Row }) {
  const [sets, setSets] = useState(String(Number(entry.target_sets)))
  const [reps, setReps] = useState(
    entry.target_reps === null || entry.target_reps === undefined ? '' : String(Number(entry.target_reps)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const check = checkRoutineTarget({ sets, reps })
    if (!check.ok) {
      setError(check.error)
      return
    }
    const ops = updateRoutineExerciseTargetOps({ current: entry, value: check.value })
    if (ops.length === 0) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onWrite(ops)
      onClose()
    } catch (err) {
      setError(`這筆沒有存下來：${errText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="tr-sheet-body tr-sheet-scroll" onSubmit={(e) => void save(e)} noValidate>
      <p className="muted tr-target-note">
        課表不存重量。做過的動作，開始訓練時一律帶入上次實際完成的組數、次數與重量；這裡只在動作從沒做過時才用。
      </p>
      <div className="tr-cardio-grid cols-2">
        <label className="tr-field">
          <span className="lb">組數</span>
          <input
            type="text"
            inputMode="numeric"
            value={sets}
            aria-label="預設組數"
            placeholder={`1–${MAX_TARGET_SETS}`}
            onChange={(e) => setSets(e.target.value)}
          />
        </label>
        <label className="tr-field">
          <span className="lb">
            次數<em>選填</em>
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={reps}
            aria-label="預設次數"
            placeholder={`1–${MAX_TARGET_REPS}`}
            onChange={(e) => setReps(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p className="tr-form-error" role="alert">
          {error}
        </p>
      )}
      <button className="action-btn" type="submit" disabled={busy}>
        儲存
      </button>
    </form>
  )
}

export default function RoutineTargetSheet({ open, entry, exerciseName, onClose, onWrite }: RoutineTargetSheetProps) {
  return (
    <SpringSheet open={open} onClose={onClose} label="預設組次" title={exerciseName} screen="routine-target" fit>
      {entry && <TargetForm key={entry.id} entry={entry} onClose={onClose} onWrite={onWrite} />}
    </SpringSheet>
  )
}
