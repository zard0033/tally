/* 新課表 sheet：只問名稱，建立後直接進課表編輯頁加動作。
   改名不走這裡（編輯頁的名稱欄就地改）。為什麼先問名稱才建：課表只能封存、不能真刪，
   「按了＋就建一份叫新課表的」放棄時會留下一筆永遠清不掉的垃圾。
   欄位狀態放在 RoutineNameForm：每次打開都是一份新的草稿。規則同 ExerciseEditSheet。 */
import { useState } from 'react'
import { Drawer } from 'vaul'
import { useSheetFocus } from '@/components/useSheetFocus'
import { checkRoutineName, createRoutineOps, type RowOp } from '@/lib/training'

interface RoutineNameSheetProps {
  open: boolean
  onClose: () => void
  onWrite: (ops: RowOp[]) => Promise<void>
  /** 建立成功後帶新課表的 id，呼叫端據此進編輯頁。 */
  onCreated: (id: string) => void
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function RoutineNameForm({ onWrite, onCreated }: Pick<RoutineNameSheetProps, 'onWrite' | 'onCreated'>) {
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
  const attach = useSheetFocus()
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
        <Drawer.Content ref={attach} tabIndex={-1} className="sheet" aria-label="新課表" data-screen="routine-name">
          <Drawer.Handle className="handle" />
          <div className="sheet-head">
            <h2 className="sheet-title">新課表</h2>
            <button className="icon-btn" type="button" aria-label="關閉" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <RoutineNameForm onWrite={onWrite} onCreated={onCreated} />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
