/* 確認對話框（樣張 ⑨）：刪除整次訓練、移除有打勾組的動作、登出時佇列非空。
   Base UI 的 AlertDialog：role="alertdialog"、焦點陷阱、Escape 取消都是現成的。
   **預設焦點落在取消鈕**：破壞性的那個要刻意去點，Enter 不該直接送出它。
   scrim 與對話框的 z-index 比 vaul 的 sheet（11）高一級——對話框會蓋在 sheet 上面彈出。 */
import { useRef, type ReactNode } from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'

interface ConfirmDialogProps {
  open: boolean
  title: string
  children: ReactNode
  cancelLabel: string
  confirmLabel: string
  /** 破壞性：確認鈕用 `--over-fill`。 */
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export default function ConfirmDialog({
  open,
  title,
  children,
  cancelLabel,
  confirmLabel,
  danger = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="scrim dialog-scrim" />
        <AlertDialog.Popup className="tr-dialog" initialFocus={cancelRef}>
          <AlertDialog.Title className="tr-dialog-title">{title}</AlertDialog.Title>
          <AlertDialog.Description className="tr-dialog-body" render={<div />}>
            {children}
          </AlertDialog.Description>
          <div className="acts">
            <button ref={cancelRef} type="button" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button type="button" className={danger ? 'danger' : undefined} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
