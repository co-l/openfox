import { useState, useEffect } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { KvCacheWarning } from '../shared/KvCacheWarning'
import { ModalFooter } from '../shared/ModalFooter'

interface InstructionsModalInfoRow {
  label: string
  value: string
}

interface InstructionsModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  label: string
  description: string
  placeholder: string
  value: string
  isLoading?: boolean
  infoRows?: InstructionsModalInfoRow[]
  onSave: (value: string) => void | Promise<void>
}

export function InstructionsModal({
  isOpen,
  onClose,
  title,
  label,
  description,
  placeholder,
  value,
  isLoading = false,
  infoRows,
  onSave,
}: InstructionsModalProps) {
  const [localValue, setLocalValue] = useState(value)
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Sync local value when external value changes
  useEffect(() => {
    setLocalValue(value)
    setIsDirty(false)
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalValue(e.target.value)
    setIsDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    await onSave(localValue)
    setSaving(false)
    setIsDirty(false)
    onClose()
  }

  const handleCancel = () => {
    setLocalValue(value)
    setIsDirty(false)
    onClose()
  }

  const isBusy = isLoading || saving

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title={title} size="lg">
      <div className="flex flex-col h-full -mt-1">
        <label className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0">{label}</label>
        <p className="text-sm text-text-muted mb-3 flex-shrink-0">{description}</p>
        {infoRows && infoRows.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-3 flex-shrink-0">
            {infoRows.map((row) => (
              <div key={row.label} className="text-sm">
                <span className="text-text-muted">{row.label}:</span>{' '}
                <span className="font-mono text-text-primary">{row.value}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-[150px]">
          <textarea
            value={localValue}
            onChange={handleChange}
            placeholder={placeholder}
            className="w-full h-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
            disabled={isBusy}
          />
        </div>

        {isDirty && <KvCacheWarning />}

        <ModalFooter onCancel={handleCancel} onSave={handleSave} saving={saving} saveDisabled={!isDirty || isBusy} />
      </div>
    </Modal>
  )
}
