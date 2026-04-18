import { useState, useCallback, type ReactNode } from 'react'
import { Button } from '../shared/Button'

export interface ConfirmDialogState {
  id: string | null
  type: 'delete' | 'restore' | 'restoreAll' | null
}

export function useConfirmDialog() {
  const [confirmState, setConfirmState] = useState<ConfirmDialogState>({ id: null, type: null })

  const requestDelete = useCallback((id: string) => setConfirmState({ id, type: 'delete' }), [])
  const requestRestore = useCallback((id: string) => setConfirmState({ id, type: 'restore' }), [])
  const requestRestoreAll = useCallback(() => setConfirmState({ id: null, type: 'restoreAll' }), [])
  const clearConfirm = useCallback(() => setConfirmState({ id: null, type: null }), [])

  const isConfirming = useCallback((id: string, type: 'delete' | 'restore') => confirmState.id === id && confirmState.type === type, [confirmState.id, confirmState.type])
  const isConfirmingRestoreAll = useCallback(() => confirmState.type === 'restoreAll', [confirmState.type])

  return { requestDelete, requestRestore, requestRestoreAll, clearConfirm, isConfirming, isConfirmingRestoreAll }
}

interface ConfirmButtonProps {
  type: 'delete' | 'restore'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmButton({ type, onConfirm, onCancel }: ConfirmButtonProps) {
  const isDelete = type === 'delete'
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onConfirm}
        className={`px-1.5 py-0.5 rounded text-xs hover:opacity-90 transition-colors ${
          isDelete ? 'bg-accent-error/20 text-accent-error hover:bg-accent-error/30' : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
        }`}
      >
        {isDelete ? 'Delete' : 'Restore'}
      </button>
      <button
        onClick={onCancel}
        className="px-1.5 py-0.5 rounded text-text-muted text-xs hover:bg-bg-primary transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}

interface DeleteIconProps {
  onClick: () => void
}

export function DeleteIcon({ onClick }: DeleteIconProps) {
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded hover:bg-bg-primary text-text-muted hover:text-accent-error transition-colors"
      title="Delete"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  )
}

interface RestoreIconProps {
  onClick: () => void
}

export function RestoreIcon({ onClick }: RestoreIconProps) {
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded hover:bg-bg-primary text-text-muted hover:text-amber-400 transition-colors"
      title="Restore default"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>
  )
}

interface FormFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  readOnly?: boolean
  hint?: ReactNode
  mono?: boolean
}

export function FormField({ label, value, onChange, placeholder, readOnly, hint, mono }: FormFieldProps) {
  return (
    <div>
      <label className="block text-xs text-text-secondary mb-1">
        {label}
        {hint && <span className="text-text-muted ml-1">{hint}</span>}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder={placeholder}
        className={`w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary ${
          mono ? 'font-mono' : ''
        } ${readOnly ? 'opacity-60' : ''}`}
      />
    </div>
  )
}

interface TextAreaProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function FormTextArea({ label, value, onChange, placeholder, className = '' }: TextAreaProps) {
  return (
    <div className={className}>
      <label className="block text-xs text-text-secondary mb-1">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
      />
    </div>
  )
}

interface ModalActionsProps {
  onCancel: () => void
  onSave: () => void
  saving: boolean
  saveDisabled?: boolean
}

export function ModalActions({ onCancel, onSave, saving, saveDisabled }: ModalActionsProps) {
  return (
    <div className="flex justify-end gap-2 pt-2 border-t border-border">
      <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      <Button variant="primary" onClick={onSave} disabled={saving || saveDisabled}>
        {saving ? 'Saving...' : 'Save'}
      </Button>
    </div>
  )
}

interface ErrorBannerProps {
  message: string
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div className="text-accent-error text-sm px-3 py-2 bg-accent-error/10 rounded">{message}</div>
  )
}

interface RestoreDefaultsHeaderProps {
  onRestoreAll: () => void
  isConfirmingRestoreAll: boolean
  onCancelRestoreAll: () => void
}

export function RestoreDefaultsHeader({ onRestoreAll, isConfirmingRestoreAll, onCancelRestoreAll }: RestoreDefaultsHeaderProps) {
  if (isConfirmingRestoreAll) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={onRestoreAll}
          className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs hover:bg-amber-500/30 transition-colors"
        >
          Confirm
        </button>
        <button
          onClick={onCancelRestoreAll}
          className="px-1.5 py-0.5 rounded text-text-muted text-xs hover:bg-bg-primary transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }
  return (
    <button
      onClick={onRestoreAll}
      className="px-2 py-1 rounded text-xs text-text-muted hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
      title="Restore all to defaults"
    >
      Restore Defaults
    </button>
  )
}