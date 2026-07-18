import { useCallback, useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/session'
import { authFetch } from '../../lib/api'
import { useModalState } from '../../hooks/useModalState'
import { ModalShell } from '../shared/ModalShell'
import { FolderIcon } from '../shared/icons'
import { CreateInputSection } from '../shared/CreateInputSection'

interface WorkspaceModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  sessionId: string
  currentWorkspace: string | null
  currentBranch: string | null
}

interface WorkspaceInfo {
  path: string
  name: string
  branch: string | null
}

export function WorkspaceModal({
  isOpen,
  onClose,
  projectId,
  sessionId,
  currentWorkspace,
  currentBranch,
}: WorkspaceModalProps) {
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
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])

  useEffect(() => {
    if (!isOpen) return
    resetState()
    authFetch(`/api/projects/${projectId}/workspaces`)
      .then((r) => r.json())
      .then((data: { workspaces: WorkspaceInfo[] }) => {
        setWorkspaces(data.workspaces)
        setLoading(false)
      })
      .catch(() => {
        setWorkspaces([])
        setLoading(false)
      })
  }, [isOpen, projectId, resetState, setLoading])

  const handleSwitch = useCallback(
    async (target: string) => {
      setError(null)
      setBusy(true)
      try {
        const res = await authFetch(`/api/sessions/${sessionId}/switch-workspace`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed to switch workspace' }))
          setError(err.error)
          setBusy(false)
          return
        }
        await refreshSession(sessionId)
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to switch workspace')
        setBusy(false)
      }
    },
    [sessionId, refreshSession, onClose, setError, setBusy],
  )

  const handleCreate = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const res = await authFetch(`/api/sessions/${sessionId}/switch-workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: newName.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create workspace' }))
        setError(err.error)
        setBusy(false)
        return
      }
      await refreshSession(sessionId)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workspace')
      setBusy(false)
    }
  }, [newName, sessionId, refreshSession, onClose, setError, setBusy])

  return (
    <ModalShell isOpen={isOpen} onClose={handleClose} title="Switch Workspace" busy={busy} loading={loading}>
      <div>
        <p className="text-sm font-medium text-text-primary mb-2">Workspaces</p>
        <div className="max-h-48 overflow-y-auto space-y-0.5 bg-bg-tertiary/30 rounded p-2 mb-4">
          <button
            onClick={() => handleSwitch('original')}
            disabled={busy}
            className={`w-full text-left px-3 py-1.5 text-sm rounded transition-colors flex items-center gap-2 ${
              !currentWorkspace
                ? 'bg-accent-primary/10 text-accent-primary cursor-default'
                : 'hover:bg-bg-tertiary text-text-secondary'
            }`}
          >
            <FolderIcon className="w-4 h-4 shrink-0" />
            <span className="font-mono truncate">original</span>
            <span className="text-xs text-text-muted ml-auto">{currentBranch ?? 'unknown'}</span>
            {!currentWorkspace && <span className="text-[10px] text-accent-primary ml-1">(current)</span>}
          </button>

          {workspaces
            .slice()
            .sort((a, b) => {
              if (a.name === currentWorkspace) return -1
              if (b.name === currentWorkspace) return 1
              return a.name.localeCompare(b.name)
            })
            .map((ws) => (
              <button
                key={ws.path}
                onClick={() => {
                  if (ws.name !== currentWorkspace) handleSwitch(ws.name)
                }}
                disabled={busy}
                className={`w-full text-left px-3 py-1.5 text-sm rounded transition-colors flex items-center gap-2 ${
                  ws.name === currentWorkspace
                    ? 'bg-accent-primary/10 text-accent-primary cursor-default'
                    : 'hover:bg-bg-tertiary text-text-secondary'
                }`}
              >
                <FolderIcon className="w-4 h-4 shrink-0" />
                <span className="font-mono truncate">{ws.name}</span>
                <span className="text-xs text-text-muted ml-auto">{ws.branch ?? 'unknown'}</span>
                {ws.name === currentWorkspace && (
                  <span className="text-[10px] text-accent-primary ml-1">(current)</span>
                )}
              </button>
            ))}
        </div>

        <CreateInputSection
          icon={<FolderIcon />}
          title="Create new workspace"
          placeholder="workspace name"
          buttonLabel="Create Workspace"
          value={newName}
          onChange={setNewName}
          onCreate={handleCreate}
          canCreate={canCreate}
          busy={busy}
        />

        {error && (
          <p className="mt-3 text-sm text-accent-error bg-accent-error/10 p-2 rounded" role="alert">
            {error}
          </p>
        )}
      </div>
    </ModalShell>
  )
}
