import { useState, useCallback } from 'react'

export function useModalState(onClose: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')

  const handleClose = useCallback(() => {
    if (!busy) onClose()
  }, [busy, onClose])

  const canCreate = newName.trim().length > 0 && !busy

  const resetState = useCallback(() => {
    setError(null)
    setBusy(false)
    setNewName('')
    setLoading(true)
  }, [])

  return {
    busy,
    setBusy,
    error,
    setError,
    loading,
    setLoading,
    newName,
    setNewName,
    handleClose,
    canCreate,
    resetState,
  }
}
