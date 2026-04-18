import { useState, useCallback } from 'react'

export type ViewMode = 'list' | 'edit'

export interface CRUDFormState<T = { [key: string]: unknown }> {
  view: ViewMode
  editingId: string | null
  formError: string
  saving: boolean
  formData: T
  setView: (view: ViewMode) => void
  setEditingId: (id: string | null) => void
  setFormError: (error: string) => void
  setFormData: (data: T | ((prev: T) => T)) => void
  setSaving: (saving: boolean) => void
  resetForm: () => void
  startEditing: (id: string, initialData: Partial<T>) => void
  startNew: () => void
}

export interface UseCRUDFormOptions<T> {
  initialData?: T
}

export function useCRUDForm<T extends { [key: string]: unknown } = { [key: string]: string }>(
  options: UseCRUDFormOptions<T> = {}
): CRUDFormState<T> {
  const { initialData = {} as T } = options

  const [view, setViewState] = useState<ViewMode>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [formData, setFormDataState] = useState<T>(initialData)

  const resetForm = useCallback(() => {
    setFormDataState(initialData)
    setFormError('')
    setEditingId(null)
  }, [initialData])

  const setView = useCallback((newView: ViewMode) => {
    setViewState(newView)
    if (newView === 'list') {
      resetForm()
    }
  }, [resetForm])

  const setFormData = useCallback((data: T | ((prev: T) => T)) => {
    setFormDataState(prev => typeof data === 'function' ? (data as (prev: T) => T)(prev) : data)
  }, [])

  const startEditing = useCallback((id: string, initialData: Partial<T> = {}) => {
    setEditingId(id)
    setViewState('edit')
    setFormDataState({ ...initialData } as T)
    setFormError('')
  }, [])

  const startNew = useCallback(() => {
    setEditingId(null)
    setViewState('edit')
    setFormDataState(initialData)
    setFormError('')
  }, [initialData])

  return {
    view,
    editingId,
    formError,
    saving,
    formData,
    setView,
    setEditingId,
    setFormError,
    setFormData,
    setSaving,
    resetForm,
    startEditing,
    startNew,
  }
}

export function useSavingState() {
  const [saving, setSaving] = useState(false)
  const startSaving = useCallback(() => setSaving(true), [])
  const stopSaving = useCallback(() => setSaving(false), [])
  return { saving, startSaving, stopSaving }
}