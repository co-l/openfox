import { useState, useCallback, type ReactNode } from 'react'
import { Button } from '../shared/Button'

export interface ConfirmDialogState {
  id: string | null
  type: 'delete' | null
}

export function useConfirmDialog() {
  const [confirmState, setConfirmState] = useState<ConfirmDialogState>({ id: null, type: null })

  const requestDelete = useCallback((id: string) => setConfirmState({ id, type: 'delete' }), [])
  const clearConfirm = useCallback(() => setConfirmState({ id: null, type: null }), [])

  const isConfirming = useCallback((id: string, type: 'delete') => confirmState.id === id && confirmState.type === type, [confirmState.id, confirmState.type])

  return { requestDelete, clearConfirm, isConfirming }
}

interface ConfirmButtonProps {
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmButton({ onConfirm, onCancel }: ConfirmButtonProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onConfirm}
        className="px-1.5 py-0.5 rounded text-xs hover:opacity-90 transition-colors bg-accent-error/20 text-accent-error hover:bg-accent-error/30"
      >
        Delete
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

interface DuplicateIconProps {
  onClick: () => void
}

export function DuplicateIcon({ onClick }: DuplicateIconProps) {
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded hover:bg-bg-primary text-text-muted hover:text-text-primary transition-colors"
      title="Duplicate"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
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