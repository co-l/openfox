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

const inputBaseClass =
  'mt-1 w-full px-3 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary'

function ParamField({
  param,
  value,
  isFirst,
  onChange,
}: {
  param: WorkflowParameter
  value: string
  isFirst: boolean
  onChange: (val: string) => void
}) {
  const labelText = param.label || param.id
  const isCheckbox = param.type === 'checkbox'

  const labelBadge = (
    <>
      <span className="text-sm text-text-primary font-medium select-none">
        {labelText}
        {param.required && <span className="text-accent-error ml-1">*</span>}
      </span>
      {param.description && <span className="block text-xs text-text-muted mt-0.5">{param.description}</span>}
    </>
  )

  if (isCheckbox) {
    return (
      <label className="flex items-start gap-2.5 p-2 rounded bg-bg-tertiary/50 border border-border cursor-pointer hover:bg-bg-tertiary transition-colors">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          className="mt-0.5 rounded border-border text-accent-primary focus:ring-accent-primary"
          autoFocus={isFirst}
        />
        <div className="flex-1 min-w-0">{labelBadge}</div>
      </label>
    )
  }

  const control =
    param.type === 'textarea' ? (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={labelText}
        rows={4}
        className={`${inputBaseClass} placeholder:text-text-muted resize-y`}
        autoFocus={isFirst}
      />
    ) : param.type === 'select' ? (
      <select
        value={value || (param.options?.[0] ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className={inputBaseClass}
        autoFocus={isFirst}
      >
        {(param.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    ) : (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={labelText}
        className={inputBaseClass}
        autoFocus={isFirst}
      />
    )

  return (
    <label className="block">
      {labelBadge}
      {control}
    </label>
  )
}

export function WorkflowParamModal({
  workflowName,
  parameters,
  onConfirm,
  onCancel,
  confirmLabel = 'Run workflow',
}: WorkflowParamModalProps) {
  const t = useT()
  const sorted = [...parameters].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const p of parameters) {
      const def = p.default ?? p.defaultValue
      if (def !== undefined) {
        init[p.id] = String(def)
      } else if (p.type === 'checkbox') {
        init[p.id] = 'false'
      } else if (p.type === 'select' && p.options && p.options.length > 0) {
        init[p.id] = p.options[0] ?? ''
      }
    }
    return init
  })

  const handleSubmit = () => {
    const collected: Record<string, string> = {}
    for (const p of sorted) {
      if (p.type === 'checkbox') {
        collected[p.id] = values[p.id] === 'true' ? 'true' : 'false'
        continue
      }
      const v = values[p.id]?.trim()
      if (v !== undefined && v !== '') {
        collected[p.id] = v
      }
    }
    onConfirm(collected)
  }

  const allRequiredFilled = sorted.every((p) => {
    if (!p.required) return true
    if (p.type === 'checkbox') return values[p.id] === 'true'
    return (values[p.id]?.trim() ?? '') !== ''
  })

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
        {sorted.map((p, idx) => (
          <ParamField
            key={p.id}
            param={p}
            value={values[p.id] ?? ''}
            isFirst={(p.position === 0 || idx === 0) && shouldAutofocus()}
            onChange={(val) => setValues((prev) => ({ ...prev, [p.id]: val }))}
          />
        ))}
      </div>
    </Modal>
  )
}
