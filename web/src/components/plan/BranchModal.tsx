import { useCallback, useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/session'
import { authFetch } from '../../lib/api'
import { Modal } from '../shared/SelfContainedModal'
import { Spinner } from '../shared/Spinner'
import { BranchIcon } from '../shared/icons'

interface BranchModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  sessionId: string
  currentBranch: string | null
  hasWorktree: boolean
  worktreeBranch?: string | null
}

interface BranchInfo {
  name: string
  current: boolean
}

interface WorktreeInfo {
  path: string
  branch: string
}

type CreateType = 'branch' | 'worktree'

export function BranchModal({
  isOpen,
  onClose,
  projectId,
  sessionId,
  currentBranch,
  hasWorktree,
  worktreeBranch,
}: BranchModalProps) {
  const refreshSession = useSessionStore((s) => s.loadSession)

  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const [selectedWorktree, setSelectedWorktree] = useState<WorktreeInfo | null>(null)
  const [newName, setNewName] = useState('feature/')
  const [createType, setCreateType] = useState<CreateType>('worktree')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setBusy(false)
    setSelectedBranch(null)
    setSelectedWorktree(null)
    setNewName('feature/')
    setCreateType('worktree')
    setLoading(true)
    Promise.all([
      authFetch(`/api/projects/${projectId}/branches`).then((r) => r.json()),
      authFetch(`/api/projects/${projectId}/worktrees`).then((r) => r.json()),
    ])
      .then(([branchesData, worktreesData]: [{ branches: BranchInfo[] }, { worktrees: WorktreeInfo[] }]) => {
        setBranches(branchesData.branches)
        setWorktrees(worktreesData.worktrees)
        setLoading(false)
      })
      .catch(() => {
        setBranches([])
        setWorktrees([])
        setLoading(false)
      })
  }, [isOpen, projectId])

  const worktreeBranchNames = new Set(worktrees.map((w) => w.branch))
  const regularBranches = branches.filter((b) => !worktreeBranchNames.has(b.name))

  const handleSwitch = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      if (hasWorktree) {
        const res = await authFetch(`/api/sessions/${sessionId}/close-worktree`, { method: 'POST' })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed to close worktree' }))
          setError(err.error)
          setBusy(false)
          return
        }
        await refreshSession(sessionId)
        onClose()
        return
      }

      if (selectedWorktree) {
        const res = await authFetch(`/api/sessions/${sessionId}/attach-worktree`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: selectedWorktree.path }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed to attach worktree' }))
          setError(err.error)
          setBusy(false)
          return
        }
        await refreshSession(sessionId)
        onClose()
        return
      }

      if (selectedBranch) {
        const res = await authFetch(`/api/projects/${projectId}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch: selectedBranch }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed to switch branch' }))
          setError(err.error)
          setBusy(false)
          return
        }
        await refreshSession(sessionId)
        onClose()
        return
      }

      if (newName.trim()) {
        // jscpd:ignore-start
        if (createType === 'worktree') {
          const res = await authFetch(`/api/sessions/${sessionId}/worktree`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName.trim() }),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Failed to create worktree' }))
            setError(err.error)
            setBusy(false)
            return
          }
        } else {
          const res = await authFetch(`/api/projects/${projectId}/checkout-new`, {
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
        }
        // jscpd:ignore-end
        await refreshSession(sessionId)
        onClose()
        return
      }

      setError('Select a branch or enter a name')
      setBusy(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed')
      setBusy(false)
    }
  }, [
    hasWorktree,
    selectedBranch,
    selectedWorktree,
    newName,
    createType,
    projectId,
    sessionId,
    refreshSession,
    onClose,
  ])

  const handleClose = useCallback(() => {
    if (!busy) onClose()
  }, [busy, onClose])

  const actionLabel = hasWorktree
    ? 'Close Worktree'
    : selectedWorktree
      ? 'Switch to Worktree'
      : selectedBranch
        ? 'Switch'
        : createType === 'worktree'
          ? 'Create Worktree'
          : 'Create Branch'

  const actionDisabled = (!hasWorktree && !selectedBranch && !selectedWorktree && !newName.trim()) || busy

  const footer = (
    <div className="flex gap-2 justify-end">
      <button
        onClick={handleClose}
        className="px-4 py-2 text-sm rounded bg-bg-tertiary text-text-secondary hover:bg-bg-secondary transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={handleSwitch}
        disabled={actionDisabled}
        className="px-4 py-2 text-sm rounded bg-accent-primary text-white hover:opacity-90 transition-colors disabled:opacity-50"
      >
        {actionLabel}
      </button>
    </div>
  )

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Switch Branch" size="md" footer={footer}>
      {loading || busy ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : hasWorktree ? (
        <div>
          <p className="text-sm text-text-muted mb-2">
            Working in worktree: <BranchIcon className="inline-block w-4 h-4 mx-1 align-text-bottom" />
            <span className="font-mono text-text-secondary">{worktreeBranch ?? currentBranch}</span>
          </p>
          <p className="text-sm text-text-muted mb-4">Close the worktree first to switch branches.</p>
          {error && <p className="text-sm text-accent-error bg-accent-error/10 p-2 rounded">{error}</p>}
        </div>
      ) : (
        <div>
          <p className="text-sm text-text-muted mb-3">
            Currently on: <BranchIcon className="inline-block w-4 h-4 mx-1 align-text-bottom" />
            <span className="font-mono text-text-secondary">{currentBranch}</span>
          </p>

          {/* Existing branches section */}
          {regularBranches.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-text-primary mb-2">Existing branches</p>
              <div className="max-h-32 overflow-y-auto space-y-0.5 bg-bg-tertiary/30 rounded p-2">
                {regularBranches.map((b) => (
                  <button
                    key={b.name}
                    onClick={() => {
                      setSelectedBranch(b.current ? null : b.name)
                      setSelectedWorktree(null)
                      setNewName('feature/')
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm rounded transition-colors flex items-center gap-2 ${
                      selectedBranch === b.name
                        ? 'bg-accent-primary/20 text-accent-primary'
                        : b.current
                          ? 'bg-bg-tertiary text-text-muted cursor-default'
                          : 'hover:bg-bg-tertiary text-text-secondary'
                    }`}
                    disabled={b.current}
                  >
                    <BranchIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-mono truncate">{b.name}</span>
                    {b.current && <span className="ml-auto text-xs text-text-muted">(current)</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* jscpd:ignore-end */}

          {/* Existing worktrees section */}
          {worktrees.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-text-primary mb-2">Existing worktrees</p>
              <div className="max-h-32 overflow-y-auto space-y-0.5 bg-bg-tertiary/30 rounded p-2">
                {worktrees.map((wt) => (
                  <button
                    key={wt.path}
                    onClick={() => {
                      setSelectedWorktree(selectedWorktree?.path === wt.path ? null : wt)
                      setSelectedBranch(null)
                      setNewName('feature/')
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm rounded transition-colors flex items-center gap-2 ${
                      selectedWorktree?.path === wt.path
                        ? 'bg-accent-primary/20 text-accent-primary'
                        : 'hover:bg-bg-tertiary text-text-secondary'
                    }`}
                  >
                    <BranchIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-mono truncate">{wt.branch}</span>
                    <span className="ml-auto text-xs text-text-muted truncate max-w-[120px]" title={wt.path}>
                      {wt.path.split('/worktrees/')[1] ?? wt.path}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Create new section */}
          <div className="mb-4">
            <p className="text-sm font-medium text-text-primary mb-2">Or create new</p>
            <div className="flex items-center gap-2 px-3 py-2 rounded border border-border bg-bg-primary focus-within:border-accent-primary mb-3">
              <BranchIcon className="w-4 h-4 shrink-0 text-text-muted" />
              <input
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value)
                  setSelectedBranch(null)
                  setSelectedWorktree(null)
                }}
                placeholder="feature/my-branch"
                className="flex-1 bg-transparent text-sm text-text-primary outline-none font-mono placeholder-text-muted"
              />
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                <input
                  type="radio"
                  name="createType"
                  value="branch"
                  checked={createType === 'branch'}
                  onChange={() => setCreateType('branch')}
                  className="text-accent-primary"
                />
                Branch
              </label>
              <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                <input
                  type="radio"
                  name="createType"
                  value="worktree"
                  checked={createType === 'worktree'}
                  onChange={() => setCreateType('worktree')}
                  className="text-accent-primary"
                />
                Worktree
              </label>
            </div>
          </div>

          {error && <p className="text-sm text-accent-error bg-accent-error/10 p-2 rounded">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
