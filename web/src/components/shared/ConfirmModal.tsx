import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { useT } from '../../hooks/useT'

interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: ReactNode
  confirmLabel?: string
  confirmVariant?: 'danger' | 'primary'
  disabled?: boolean
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  confirmVariant = 'primary',
  disabled = false,
}: ConfirmModalProps) {
  const t = useT()
  const resolvedConfirmLabel = confirmLabel ?? t({ en: 'Confirm', fr: 'Confirmer' })
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={disabled}>
            {t({ en: 'Cancel', fr: 'Annuler' })}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={disabled} autoFocus>
            {resolvedConfirmLabel}
          </Button>
        </div>
      }
    >
      <div className="text-text-secondary">{message}</div>
    </Modal>
  )
}
