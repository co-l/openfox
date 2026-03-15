import { useState, useEffect } from 'react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'

interface InstructionsModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  label: string
  description: string
  placeholder: string
  value: string
  isLoading?: boolean
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
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">
            {label}
          </label>
          <p className="text-sm text-text-muted mb-2">
            {description}
          </p>
          <textarea
            value={localValue}
            onChange={handleChange}
            placeholder={placeholder}
            className="w-full h-64 px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
            disabled={isBusy}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!isDirty || isBusy}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
