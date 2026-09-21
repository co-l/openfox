import { Button } from './Button'
import { useT } from '../../hooks/useT'

interface SaveCancelButtonsProps {
  onCancel: () => void
  onSave: () => void
  saving: boolean
  saveLabel: string
}

export function SaveCancelButtons({ onCancel, onSave, saving, saveLabel }: SaveCancelButtonsProps) {
  const t = useT()
  return (
    <div className="flex items-center gap-2 shrink-0">
      <Button onClick={onCancel}>{t({ en: 'Cancel', fr: 'Annuler' })}</Button>
      <Button variant="primary" onClick={onSave} disabled={saving}>
        {saving ? t({ en: 'Saving…', fr: 'Enregistrement…' }) : saveLabel}
      </Button>
    </div>
  )
}
