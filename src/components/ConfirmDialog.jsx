import * as Dialog from '@radix-ui/react-dialog'
import Button from './Button'

// 通用确认弹窗（基于 Radix Dialog）
// props: open, onOpenChange, title, description, onConfirm, confirmText, danger
export default function ConfirmDialog({
  open,
  onOpenChange,
  title = '确认操作',
  description,
  onConfirm,
  confirmText = '确认',
  cancelText = '取消',
  danger = false
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="DialogOverlay" />
        <Dialog.Content className="DialogContent">
          <Dialog.Title className="DialogTitle">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="DialogDescription">
              {description}
            </Dialog.Description>
          )}
          <div className="DialogActions">
            <Dialog.Close asChild>
              <Button variant="ghost">{cancelText}</Button>
            </Dialog.Close>
            <Button
              variant={danger ? 'danger' : 'primary'}
              onClick={() => {
                onConfirm?.()
                onOpenChange?.(false)
              }}
            >
              {confirmText}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
