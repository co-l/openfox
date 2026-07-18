import { useCallback, useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/session'
import { authFetch } from '../../lib/api'
import { useModalState } from '../../hooks/useModalState'
import { ModalShell } from '../shared/ModalShell'
import { BranchIcon } from '../shared/icons'
import { CreateInputSection } from '../shared/CreateInputSection'

interface BranchModalProps {
  isOpen: boolean
  onClose: () => void
  sessionId: string
}

interface BranchInfo {
  name: string
  current: boolean
}

export function BranchModal({ isOpen, onClose, sessionId }: BranchModalProps) {
  const refreshSession = useSessionStore((s) => s.loadSession)
  const {
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
  } = useModalState(onClose)
  const [branches, setBranches] = useState<BranchInfo[]>([])

  useEffect(() => {
    if (!isOpen) return
    resetState()
    authFetch(`/api/sessions/${sessionId}/branches`)
      .then((r) => r.json())
      .then((data: { branches: BranchInfo[] }) => {
        setBranches(data.branches)
        setLoading(false)
      })
      .catch(() => {
        setBranches([])
        setLoading(false)
      })
  }, [isOpen, sessionId, resetState, setLoading])

  const handleSwitch = useCallback(
    async (branchName: string) => {
      setError(null)
      setBusy(true)
      try {
        const res = await authFetch(`/api/sessions/${sessionId}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch: branchName }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed to switch branch' }))
          setError(err.error)
          setBusy(false)
          return
        }
        await refreshSession(sessionId)
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to switch branch')
        setBusy(false)
      }
    },
    [sessionId, refreshSession, onClose, setError, setBusy],
  )

  const handleCreate = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const res = await authFetch(`/api/sessions/${sessionId}/checkout-new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create branch' }))
        setError(err.error)
        setBusy(false)
        return
      }
      await refreshSession(sessionId)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create branch')
      setBusy(false)
    }
  }, [newName, sessionId, refreshSession, onClose, setError, setBusy])

  return (
    <ModalShell isOpen={isOpen} onClose={handleClose} title="Switch Branch" busy={busy} loading={loading}>
      <div>
        {branches.length > 0 && (
          <div className="mb-4">
            <p className="text-sm font-medium text-text-primary mb-2">Branches</p>
            <div className="max-h-48 overflow-y-auto space-y-0.5 bg-bg-tertiary/30 rounded p-2">
              {branches.map((b) => (
                <button
                  key={b.name}
                  onClick={() => {
                    if (!b.current) handleSwitch(b.name)
                  }}
                  disabled={busy}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded transition-colors flex items-center gap-2 ${
                    b.current
                      ? 'bg-accent-primary/10 text-accent-primary cursor-default'
                      : 'hover:bg-bg-tertiary text-text-secondary'
                  }`}
                >
                  <BranchIcon className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-mono truncate">{b.name}</span>
                  {b.current && <span className="ml-auto text-xs text-text-muted">(current)</span>}
                  {!b.current && <span className="ml-auto text-xs text-accent-primary">Switch</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <CreateInputSection
          icon={<BranchIcon />}
          title="Create new branch"
          placeholder="feature/my-branch"
          buttonLabel="Create Branch"
          value={newName}
          onChange={setNewName}
          onCreate={handleCreate}
          canCreate={canCreate}
          busy={busy}
        />

        {error && <p className="mt-3 text-sm text-accent-error bg-accent-error/10 p-2 rounded">{error}</p>}
      </div>
    </ModalShell>
  )
}
