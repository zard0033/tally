/* 新課表 sheet：只問名稱，建立後直接進課表編輯頁加動作。
   改名不走這裡（編輯頁的名稱欄就地改）。為什麼先問名稱才建：課表只能封存、不能真刪，
   「按了＋就建一份叫新課表的」放棄時會留下一筆永遠清不掉的垃圾。
   欄位狀態放在 RoutineNameForm：每次打開都是一份新的草稿。規則同 ExerciseEditSheet。
   走自製的 SpringSheet（全站精緻度改版 B0 的試點之一：有輸入欄，用來驗 iOS 鍵盤）。 */
import { useRef, useState } from 'react'
import SpringSheet from '@/components/SpringSheet'
import { checkRoutineName, createRoutineOps, type RowOp } from '@/lib/training'

interface RoutineNameSheetProps {
  open: boolean
  onClose: () => void
  onWrite: (ops: RowOp[]) => Promise<void>
  /** 建立成功後帶新課表的 id，呼叫端據此進編輯頁。 */
  onCreated: (id: string) => void
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function RoutineNameForm({
  onWrite,
  onCreated,
  inputRef,
}: Pick<RoutineNameSheetProps, 'onWrite' | 'onCreated'> & { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const check = checkRoutineName(name)
    if (!check.ok) {
      setError(check.error)
      return
    }
    setBusy(true)
    setError(null)
    const id = crypto.randomUUID()
    try {
      await onWrite(createRoutineOps({ id, name: check.name }))
      onCreated(id)
    } catch (err) {
      setError(`這筆沒有存下來：${errText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="tr-sheet-body tr-sheet-scroll" onSubmit={(e) => void submit(e)} noValidate>
      <label className="tr-field">
        <span className="lb">課表名稱</span>
        <input
          ref={inputRef}
          className="is-text"
          type="text"
          value={name}
          aria-label="課表名稱"
          placeholder="例如：菜單 A"
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {error && (
        <p className="tr-form-error" role="alert">
          {error}
        </p>
      )}
      <button className="action-btn" type="submit" disabled={busy}>
        建立
      </button>
    </form>
  )
}

export default function RoutineNameSheet({ open, onClose, onWrite, onCreated }: RoutineNameSheetProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <SpringSheet open={open} onClose={onClose} label="新課表" title="新課表" screen="routine-name" fit initialFocus={inputRef}>
      <RoutineNameForm onWrite={onWrite} onCreated={onCreated} inputRef={inputRef} />
    </SpringSheet>
  )
}
