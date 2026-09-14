import { ScrollArea } from '../shared/ScrollArea'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { authFetch } from '../../lib/api'
import { sessionBranchesResource } from '../../lib/resources'
import { useSessionModalState } from '../../hooks/useSessionModalState'
import { ModalShell } from '../shared/ModalShell'
import { BranchIcon, SearchIcon } from '../shared/icons'
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
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [sourceBranch, setSourceBranch] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (!isOpen) return
    resetState()
    setSourceBranch('')
    setBranches([])
    setDefaultBranch('')
    setSearchQuery('')
    sessionBranchesResource
      .refresh(sessionId)
      .then((data) => {
        setBranches(data?.branches ?? [])
        setDefaultBranch(data?.defaultBranch ?? '')
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
          const err = await res
            .json()
            .catch(() => ({ error: t({ en: 'Failed to switch branch', fr: 'Échec du changement de branche' }) }))
          setError(err.error)
          setBusy(false)
          return
        }
        await refreshSession(sessionId, true)
        onClose()
      } catch (e) {
        setError(
          e instanceof Error ? e.message : t({ en: 'Failed to switch branch', fr: 'Échec du changement de branche' }),
        )
        setBusy(false)
      }
    },
    [sessionId, refreshSession, onClose, setError, setBusy, t],
  )

  const handleCreate = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const body: Record<string, string> = { name: newName.trim() }
      if (sourceBranch) body.sourceBranch = sourceBranch
      const res = await authFetch(`/api/sessions/${sessionId}/checkout-new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: t({ en: 'Failed to create branch', fr: 'Échec de la création de la branche' }) }))
        setError(err.error)
        setBusy(false)
        return
      }
      await refreshSession(sessionId)
      onClose()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t({ en: 'Failed to create branch', fr: 'Échec de la création de la branche' }),
      )
      setBusy(false)
    }
  }, [newName, sourceBranch, sessionId, refreshSession, onClose, setError, setBusy, t])

  const filteredBranches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return branches
    return branches.filter((b) => b.name.toLowerCase().includes(q))
  }, [branches, searchQuery])

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={handleClose}
      title={t({ en: 'Switch Branch', fr: 'Changer de branche' })}
      busy={busy}
      loading={loading}
    >
      <div>
        {branches.length > 0 && (
          <div className="mb-4">
            <p className="text-sm font-medium text-text-primary mb-2">{t({ en: 'Branches', fr: 'Branches' })}</p>
            <div className="relative mb-2">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t({ en: 'Search branches…', fr: 'Rechercher des branches…' })}
                aria-label={t({ en: 'Search branches', fr: 'Rechercher des branches' })}
                className="w-full text-sm bg-bg-primary border border-border-default rounded pl-8 pr-2 py-1.5 text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
              />
            </div>
            {filteredBranches.length > 0 ? (
              <ScrollArea className="max-h-48 space-y-0.5 bg-bg-tertiary/30 rounded p-2">
                {filteredBranches.map((b) => (
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
                    {b.current && (
                      <span className="ml-auto text-xs text-text-muted">
                        {t({ en: '(current)', fr: '(actuelle)' })}
                      </span>
                    )}
                    {!b.current && (
                      <span className="ml-auto text-xs text-accent-primary">{t({ en: 'Switch', fr: 'Changer' })}</span>
                    )}
                  </button>
                ))}
              </ScrollArea>
            ) : (
              <p className="text-xs text-text-muted py-2 text-center bg-bg-tertiary/30 rounded">
                {t({ en: 'No branches match', fr: 'Aucune branche ne correspond' })}
              </p>
            )}
          </div>
        )}

        <CreateInputSection
          icon={<BranchIcon />}
          title={t({ en: 'Create new branch', fr: 'Créer une nouvelle branche' })}
          placeholder="feature/my-branch"
          buttonLabel={t({ en: 'Create Branch', fr: 'Créer la branche' })}
          value={newName}
          onChange={setNewName}
          onCreate={handleCreate}
          canCreate={canCreate}
          busy={busy}
        />

        {newName.trim() && (
          <div className="mt-2">
            <label className="text-xs text-text-muted mb-1 block">
              {t(
                {
                  en: 'From branch (optional — defaults to {{defaultBranch}})',
                  fr: 'Depuis la branche (facultatif — défaut : {{defaultBranch}})',
                },
                { defaultBranch: defaultBranch || t({ en: 'project default', fr: 'branche par défaut du projet' }) },
              )}
            </label>
            <div className="relative">
              <BranchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={sourceBranch}
                onChange={(e) => setSourceBranch(e.target.value)}
                placeholder={defaultBranch || 'main'}
                className="w-full text-sm bg-bg-primary border border-border-default rounded pl-8 pr-2 py-1.5 text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
              />
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-accent-error bg-accent-error/10 p-2 rounded">{error}</p>}
      </div>
    </ModalShell>
  )
}
