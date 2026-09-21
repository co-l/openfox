import { Button } from './Button'
import { useT } from '../../hooks/useT'

interface ModalFooterProps {
  onCancel: () => void
  onSave: () => void
  saving: boolean
  saveDisabled?: boolean
  cancelLabel?: string
  saveLabel?: string
}

export function ModalFooter({ onCancel, onSave, saving, saveDisabled, cancelLabel, saveLabel }: ModalFooterProps) {
  const t = useT()
  return (
    <div className="flex justify-end gap-2 flex-shrink-0">
      <Button variant="secondary" onClick={onCancel}>
        {cancelLabel ?? t({ en: 'Cancel', fr: 'Annuler' })}
      </Button>
      <Button variant="primary" onClick={onSave} disabled={saveDisabled ?? saving}>
        {saveLabel ?? (saving ? t({ en: 'Saving...', fr: 'Enregistrement…' }) : t({ en: 'Save', fr: 'Enregistrer' }))}
      </Button>
    </div>
  )
}
