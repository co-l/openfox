import { ScrollArea } from '../shared/ScrollArea'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'wouter'
import { authFetch } from '../../lib/api'
import { workspacesResource } from '../../lib/resources'
import { useSessionModalState } from '../../hooks/useSessionModalState'
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
  const {
    t,
    refreshSession,
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
  } = useSessionModalState(onClose)
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [conflictingSessionIds, setConflictingSessionIds] = useState<string[] | null>(null)
  const [forceDeleting, setForceDeleting] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    resetState()
    setConfirmDelete(null)
    setConflictingSessionIds(null)
    setForceDeleting(false)
    workspacesResource
      .refresh(projectId)
      .then((workspaces) => {
        setWorkspaces(workspaces ?? [])
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
          const err = await res.json().catch(() => ({
            error: t({ en: 'Failed to switch workspace', fr: 'Échec du changement d’espace de travail' }),
          }))
          setError(err.error)
          setBusy(false)
          return
        }
        await refreshSession(sessionId, true)
        onClose()
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : t({ en: 'Failed to switch workspace', fr: 'Échec du changement d’espace de travail' }),
        )
        setBusy(false)
      }
    },
    [sessionId, refreshSession, onClose, setError, setBusy, t],
  )

  const handleDelete = useCallback(
    async (name: string, options?: { force?: boolean }) => {
      setError(null)
      setConflictingSessionIds(null)
      setForceDeleting(options?.force === true)
      setBusy(true)
      try {
        const res = await authFetch(`/api/sessions/${sessionId}/delete-workspace`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: name, force: options?.force === true }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({
            error: t({ en: 'Failed to delete workspace', fr: 'Échec de la suppression de l’espace de travail' }),
          }))
          setError(err.error)
          if (err.conflictingSessionIds) {
            setConflictingSessionIds(err.conflictingSessionIds)
          }
          setForceDeleting(false)
          setBusy(false)
          return
        }
        setConfirmDelete(null)
        setForceDeleting(false)
        await refreshSession(sessionId, true)
        // Refresh the workspace list
        const listRes = await authFetch(`/api/projects/${projectId}/workspaces`)
        const listData = await listRes.json()
        setWorkspaces(listData.workspaces)
        setBusy(false)
        setLoading(false)
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : t({ en: 'Failed to delete workspace', fr: 'Échec de la suppression de l’espace de travail' }),
        )
        setForceDeleting(false)
        setBusy(false)
      }
    },
    [sessionId, projectId, refreshSession, setError, setBusy, t],
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
        const err = await res.json().catch(() => ({
          error: t({ en: 'Failed to create workspace', fr: 'Échec de la création de l’espace de travail' }),
        }))
        setError(err.error)
        setBusy(false)
        return
      }
      await refreshSession(sessionId)
      onClose()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t({ en: 'Failed to create workspace', fr: 'Échec de la création de l’espace de travail' }),
      )
      setBusy(false)
    }
  }, [newName, sessionId, refreshSession, onClose, setError, setBusy, t])

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={handleClose}
      title={t({ en: 'Switch Workspace', fr: 'Changer d’espace de travail' })}
      busy={busy}
      loading={loading}
    >
      <div>
        <p className="text-sm font-medium text-text-primary mb-2">
          {t({ en: 'Workspaces', fr: 'Espaces de travail' })}
        </p>
        <ScrollArea className="max-h-48 space-y-0.5 bg-bg-tertiary/30 rounded p-2 mb-4">
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
            <span className="text-xs text-text-muted ml-auto">
              {currentBranch ?? t({ en: 'unknown', fr: 'inconnue' })}
            </span>
            {!currentWorkspace && (
              <span className="text-[10px] text-accent-primary ml-1">{t({ en: '(current)', fr: '(actuel)' })}</span>
            )}
          </button>

          {workspaces
            .slice()
            .sort((a, b) => {
              if (a.name === currentWorkspace) return -1
              if (b.name === currentWorkspace) return 1
              return a.name.localeCompare(b.name)
            })
            .map((ws) => (
              <div key={ws.path} className="group relative">
                {confirmDelete === ws.name ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 text-sm rounded bg-accent-error/10">
                    <span className="text-xs text-accent-error">
                      {t({ en: 'Delete {{name}}?', fr: 'Supprimer {{name}} ?' }, { name: ws.name })}
                    </span>
                    <button
                      onClick={() => handleDelete(ws.name)}
                      disabled={busy}
                      className="ml-auto text-xs px-2 py-0.5 rounded bg-accent-error text-white hover:opacity-90"
                    >
                      {t({ en: 'Confirm', fr: 'Confirmer' })}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      disabled={busy}
                      className="text-xs px-2 py-0.5 rounded bg-bg-tertiary text-text-secondary hover:bg-bg-secondary"
                    >
                      {t({ en: 'Cancel', fr: 'Annuler' })}
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <button
                      onClick={() => {
                        if (!busy && ws.name !== currentWorkspace) handleSwitch(ws.name)
                      }}
                      disabled={busy || ws.name === currentWorkspace}
                      className={`w-full text-left px-3 py-1.5 text-sm rounded transition-colors flex items-center gap-2 ${
                        ws.name === currentWorkspace
                          ? 'bg-accent-primary/10 text-accent-primary cursor-default'
                          : 'hover:bg-bg-tertiary text-text-secondary'
                      } ${busy ? 'opacity-70' : ''}`}
                    >
                      <FolderIcon className="w-4 h-4 shrink-0" />
                      <span className="font-mono truncate">{ws.name}</span>
                      <span className="text-xs text-text-muted ml-auto">
                        {ws.branch ?? t({ en: 'unknown', fr: 'inconnue' })}
                      </span>
                      {ws.name === currentWorkspace && (
                        <span className="text-[10px] text-accent-primary ml-1">
                          {t({ en: '(current)', fr: '(actuel)' })}
                        </span>
                      )}
                    </button>
                    {ws.name !== currentWorkspace && !busy && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setError(null)
                          setConflictingSessionIds(null)
                          setConfirmDelete(ws.name)
                        }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-xs text-text-muted hover:text-accent-error transition-opacity px-1 py-0.5 rounded"
                        title={t({ en: 'Delete workspace', fr: 'Supprimer l’espace de travail' })}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
        </ScrollArea>

        <CreateInputSection
          icon={<FolderIcon />}
          title={t({ en: 'Create new workspace', fr: 'Créer un nouvel espace de travail' })}
          placeholder="workspace name"
          buttonLabel={t({ en: 'Create Workspace', fr: 'Créer l’espace de travail' })}
          value={newName}
          onChange={setNewName}
          onCreate={handleCreate}
          canCreate={canCreate}
          busy={busy}
        />

        {error && (
          <div className="mt-3 text-sm bg-accent-error/10 p-2 rounded" role="alert">
            <p className="text-accent-error">{error}</p>
            {conflictingSessionIds && conflictingSessionIds.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-text-muted">
                  {t({ en: 'Conflicting sessions:', fr: 'Sessions en conflit :' })}
                </p>
                <ul className="space-y-0.5">
                  {conflictingSessionIds.map((sid) => (
                    <li key={sid}>
                      <Link
                        href={`/p/${projectId}/s/${sid}`}
                        className="text-xs font-mono text-accent-primary hover:underline break-all"
                      >
                        {sid}
                      </Link>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleDelete(confirmDelete ?? '', { force: true })}
                  disabled={busy || !confirmDelete}
                  className="mt-2 text-xs px-2 py-1 rounded bg-accent-warning text-black hover:opacity-90 disabled:opacity-50"
                  aria-label={t({
                    en: 'Force delete workspace, switching other sessions to original',
                    fr: 'Supprimer de force l’espace de travail, en basculant les autres sessions vers original',
                  })}
                >
                  {forceDeleting
                    ? t({ en: 'Processing...', fr: 'Traitement…' })
                    : t({
                        en: 'Force Delete (switch other sessions to original)',
                        fr: 'Suppression forcée (bascule des autres sessions vers original)',
                      })}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  )
}
