import { useState } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { useT } from '../../hooks/useT'
import type { WorkflowParameter } from '@shared/types.js'
import { shouldAutofocus } from '../../lib/device'

interface WorkflowParamModalProps {
  workflowName: string
  parameters: WorkflowParameter[]
  onConfirm: (params: Record<string, string>) => void
  onCancel: () => void
  confirmLabel?: string
}

export function WorkflowParamModal({
  workflowName,
  parameters,
  onConfirm,
  onCancel,
  confirmLabel = 'Run workflow',
}: WorkflowParamModalProps) {
  const t = useT()
  const [values, setValues] = useState<Record<string, string>>({})

  const sorted = [...parameters].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  const handleSubmit = () => {
    const collected: Record<string, string> = {}
    for (const p of sorted) {
      const v = values[p.id]?.trim()
      if (v) collected[p.id] = v
    }
    onConfirm(collected)
  }

  const allRequiredFilled = sorted.every((p) => !p.required || (values[p.id]?.trim() ?? '') !== '')

  return (
    <Modal
      isOpen
      onClose={onCancel}
      title={t({ en: 'Run: {{name}}', fr: 'Exécuter : {{name}}' }, { name: workflowName })}
      size="sm"
      closeOnEscape
      closeOnBackdropClick
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            {t({ en: 'Cancel', fr: 'Annuler' })}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!allRequiredFilled}
            className="px-4 py-1.5 text-sm font-medium rounded bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {confirmLabel === 'Run workflow' ? t({ en: 'Run workflow', fr: 'Exécuter le workflow' }) : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {sorted.map((p) => (
          <label key={p.id} className="block">
            <span className="text-sm text-text-primary font-medium">
              {p.label || p.id}
              {p.required && <span className="text-accent-error ml-1">*</span>}
            </span>
            {p.description && <span className="block text-xs text-text-muted mt-0.5">{p.description}</span>}
            <input
              value={values[p.id] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [p.id]: e.target.value }))}
              placeholder={p.label || p.id}
              className="mt-1 w-full px-3 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
              autoFocus={(p.position === 0 || p === sorted[0]) && shouldAutofocus()}
            />
          </label>
        ))}
      </div>
    </Modal>
  )
}
