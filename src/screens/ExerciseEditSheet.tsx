/* 編輯動作 sheet（樣張 ⑦b）：名稱 → 肌群（下拉）→ 要點；儲存釘在底部（v2.91）。
   封存／取消封存不在這裡，在動作庫每一列的圖示鈕（v2.93）；已封存的動作點進來一樣能改這三欄。
   動作庫頁與訓練中點要點塊的筆圖示開的是**同一張**（AC 3）；exercise 為 null＝新增。
   寫入走 onWrite（排進離線佇列）；失敗留在 sheet 裡說明，不關。
   欄位狀態放在 ExerciseForm、以動作 id 當 key：每次打開都是一份新的草稿，不會殘留上一次打到一半的字。 */
import { useRef, useState } from 'react'
import SpringSheet from '@/components/SpringSheet'
import { useScrollFocusedIntoView } from '@/components/useScrollFocusedIntoView'
import {
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABEL,
  checkExercise,
  createExerciseOps,
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

  // 鍵盤升起後把聚焦欄位（多半是最下面的要點）捲進欄位區，理由見 hook 檔頭
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useScrollFocusedIntoView(scrollRef)

  /* 版型同全站表單 sheet（記一筆、食品庫新增）：可捲的 `.form-wrap` ＋ 兄弟節點 `.confirm-wrap` 釘底（v2.91）。
     原本儲存是捲動內容的最後一個子節點，鍵盤升起、sheet 縮到約 400px 後它落在可視範圍外
     （真機回報：點要點叫出鍵盤，儲存被蓋住）。兩塊仍在同一個 `<form>` 裡：名稱欄按 Enter 送出
     要找得到 `type="submit"`。 */
  return (
    <form className="tr-edit-form" onSubmit={save} noValidate>
      <div className="form-wrap" ref={scrollRef}>
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
      </div>
      <div className="confirm-wrap">
        {/* 錯誤放在釘底列、儲存鈕上方（同食品庫新增）：鍵盤升起時欄位區只剩一小截，放在欄位區裡會被捲走 */}
        {error && (
          <p className="sheet-error" role="alert">
            {error}
          </p>
        )}
        <button className="pick-bar-btn" type="submit" disabled={busy}>
          儲存
        </button>
      </div>
    </form>
  )
}

export default function ExerciseEditSheet({ open, exercise, exercises, onClose, onWrite }: ExerciseEditSheetProps) {
  const title = exercise ? '編輯動作' : '新增動作'

  return (
    <SpringSheet open={open} onClose={onClose} label={title} title={title} screen="exercise-edit" fit>
      <ExerciseForm key={exercise?.id ?? 'new'} exercise={exercise} exercises={exercises} onClose={onClose} onWrite={onWrite} />
    </SpringSheet>
  )
}
