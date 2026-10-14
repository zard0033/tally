/* 編輯動作 sheet（樣張 ⑦b）：名稱 → 肌群（下拉）→ 要點，儲存獨佔一行，封存降成底下的文字鈕。
   動作庫頁與訓練中點要點塊的筆圖示開的是**同一張**（AC 3）；exercise 為 null＝新增。
   寫入走 onWrite（排進離線佇列）；失敗留在 sheet 裡說明，不關。
   欄位狀態放在 ExerciseForm、以動作 id 當 key：每次打開都是一份新的草稿，不會殘留上一次打到一半的字。 */
import { useState } from 'react'
import { Drawer } from 'vaul'
import { useSheetFocus } from '@/components/useSheetFocus'
import {
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABEL,
  checkExercise,
  createExerciseOps,
  setExerciseArchivedOps,
  updateExerciseOps,
  type Row,
  type RowOp,
} from '@/lib/training'

interface ExerciseEditSheetProps {
  open: boolean
  /** null＝新增一個動作。 */
  exercise: Row | null
  /** 全部動作（含封存）：檢查重名要用。 */
  exercises: readonly Row[]
  onClose: () => void
  onWrite: (ops: RowOp[]) => Promise<void>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface FormProps extends Omit<ExerciseEditSheetProps, 'open'> {}

function ExerciseForm({ exercise, exercises, onClose, onWrite }: FormProps) {
  const [name, setName] = useState(exercise ? String(exercise.name) : '')
  // 資料異常（肌群不在七類）時落在「其他」，與清單的歸類一致，否則 select 顯示第一項、state 卻是壞值
  const [group, setGroup] = useState(() => {
    const g = String(exercise?.muscle_group)
    return (MUSCLE_GROUPS as readonly string[]).includes(g) ? g : 'other'
  })
  const [tips, setTips] = useState(typeof exercise?.tips === 'string' ? exercise.tips : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (ops: RowOp[]) => {
    if (ops.length === 0) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onWrite(ops)
      onClose()
    } catch (e) {
      setError(`這筆沒有存下來：${errText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    const check = checkExercise({ name, muscle_group: group, tips }, exercises, exercise?.id)
    if (!check.ok) {
      setError(check.error)
      return
    }
    void run(
      exercise
        ? updateExerciseOps({ current: exercise, value: check.value })
        : createExerciseOps({ id: crypto.randomUUID(), value: check.value }),
    )
  }

  const archived = exercise?.archived === true

  return (
    <form className="tr-sheet-body tr-sheet-scroll" onSubmit={save} noValidate>
      <label className="tr-field">
        <span className="lb">名稱</span>
        <input
          className="is-text"
          type="text"
          value={name}
          aria-label="名稱"
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="tr-field">
        <span className="lb">肌群</span>
        <select value={group} aria-label="肌群" onChange={(e) => setGroup(e.target.value)}>
          {MUSCLE_GROUPS.map((g) => (
            <option key={g} value={g}>
              {MUSCLE_GROUP_LABEL[g]}
            </option>
          ))}
        </select>
      </label>
      <label className="tr-field">
        <span className="lb">
          要點<em>在器材前看的提示，可略過</em>
        </span>
        <textarea value={tips} aria-label="要點" rows={4} onChange={(e) => setTips(e.target.value)} />
      </label>

      {error && (
        <p className="tr-form-error" role="alert">
          {error}
        </p>
      )}
      <button className="action-btn" type="submit" disabled={busy}>
        儲存
      </button>
      {exercise && (
        <button
          className="tr-text-btn is-quiet tr-text-btn-center"
          type="button"
          disabled={busy}
          onClick={() => void run(setExerciseArchivedOps({ id: exercise.id, archived: !archived }))}
        >
          {archived ? '取消封存這個動作' : '封存這個動作'}
        </button>
      )}
    </form>
  )
}

export default function ExerciseEditSheet({ open, exercise, exercises, onClose, onWrite }: ExerciseEditSheetProps) {
  const attach = useSheetFocus()
  const title = exercise ? '編輯動作' : '新增動作'

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
      direction="bottom"
      shouldScaleBackground={false}
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="scrim" />
        <Drawer.Content ref={attach} tabIndex={-1} className="sheet" aria-label={title} data-screen="exercise-edit">
          <Drawer.Handle className="handle" />
          <div className="sheet-head">
            <h2 className="sheet-title">{title}</h2>
            <button className="icon-btn" type="button" aria-label="關閉" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <ExerciseForm
            key={exercise?.id ?? 'new'}
            exercise={exercise}
            exercises={exercises}
            onClose={onClose}
            onWrite={onWrite}
          />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
