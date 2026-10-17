/* 確認對話框（樣張 ⑨）：刪除整次訓練、移除有打勾組的動作、登出時佇列非空、sheet 裡的刪除確認。
   Base UI 的 AlertDialog：role="alertdialog"、焦點陷阱、Escape 取消都是現成的；從開著的 SpringSheet 裡問也一樣
   掛在 body——Base UI 靠 React 樹判斷巢狀，Escape 只關最內層、在對話框上往下滑也不會碰到 sheet 的拖曳（拖曳只從把手起手）。
   **預設焦點落在取消鈕**：破壞性的那個要刻意去點，Enter 不該直接送出它。
   scrim 與對話框的 z-index 比 sheet（11）高一級。 */
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
