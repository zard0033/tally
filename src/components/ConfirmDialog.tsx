/* 確認對話框（樣張 ⑨）：刪除整次訓練、移除有打勾組的動作、登出時佇列非空。
   Base UI 的 AlertDialog：role="alertdialog"、焦點陷阱、Escape 取消都是現成的。
   **預設焦點落在取消鈕**：破壞性的那個要刻意去點，Enter 不該直接送出它。
   scrim 與對話框的 z-index 比 vaul 的 sheet（11）高一級。
   **從開著的 sheet 裡問，要傳 `container`＝那張 sheet 的 Drawer.Content**：vaul 是 Radix 的 modal 層，
   以 DOM 是否在 content 裡判斷內外——掛在 body 的對話框被當成「外面」：焦點被搶回 sheet、點擊被 sheet 攔下
   （實測：預設焦點不在取消、「刪除」按不到）。掛進 sheet 之後它在 sheet 的 transform 底下，
   fixed 定位改以 sheet 為準：scrim 只蓋 sheet、對話框置中在 sheet 裡。 */
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
  /** 從開著的 sheet 裡問時傳那張 sheet 的 content 節點；不傳＝掛在 body。 */
  container?: HTMLElement | null
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
  container,
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
      <AlertDialog.Portal container={container ?? undefined}>
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
