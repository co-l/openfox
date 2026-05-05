import { Button } from './Button'

interface ModalFooterProps {
  onCancel: () => void
  onSave: () => void
  saving: boolean
  saveDisabled?: boolean
  cancelLabel?: string
  saveLabel?: string
}

export function ModalFooter({
  onCancel,
  onSave,
  saving,
  saveDisabled,
  cancelLabel = 'Cancel',
  saveLabel = saving ? 'Saving...' : 'Save',
}: ModalFooterProps) {
  return (
    <div className="flex justify-end gap-2 pt-2 border-t border-border flex-shrink-0">
      <Button variant="secondary" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button variant="primary" onClick={onSave} disabled={saveDisabled ?? saving}>
        {saveLabel}
      </Button>
    </div>
  )
}
