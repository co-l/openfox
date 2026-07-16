import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { useSessionStore } from '../stores/session'
import { authFetch } from '../lib/api'
import { Spinner } from './shared/Spinner'

interface NewSessionModalProps {
  isOpen: boolean
  onClose: () => void
}

interface GitInfo {
  isGit: boolean
  branch: string | null
  worktrees: { path: string; branch: string }[]
}

function createSession(projectId: string, title?: string, worktree?: string): Promise<{ session: { id: string } }> {
  return authFetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, title, ...(worktree ? { worktree } : {}) }),
  }).then(async (res) => {
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errBody.error || `Request failed (${res.status})`)
    }
    return res.json()
  })
}

export function NewSessionModal({ isOpen, onClose }: NewSessionModalProps) {
  const [, navigate] = useLocation()
  const projectId = typeof window !== 'undefined' ? window.location.pathname.match(/\/p\/([^/]+)/)?.[1] : undefined
  const resetPendingSessionCreate = useSessionStore((s) => s.resetPendingSessionCreate)

  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [worktreeName, setWorktreeName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !projectId) return
    setWorktreeName('')
    setCreating(false)
    setError(null)
    setGitInfo(null)
    authFetch(`/api/projects/${projectId}/git-info`)
      .then((r) => r.json())
      .then(async (info: GitInfo) => {
        if (!info.isGit) {
          handleCreate(undefined)
          return
        }
        setGitInfo(info)
      })
      .catch(() => {
        handleCreate(undefined)
      })
  }, [isOpen, projectId])

  const handleCreate = useCallback(
    async (wt?: string) => {
      if (!projectId) return
      setCreating(true)
      setError(null)
      try {
        const data = await createSession(projectId, undefined, wt || undefined)
        resetPendingSessionCreate()
        onClose()
        navigate(`/p/${projectId}/s/${data.session.id}`)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create session')
        setCreating(false)
      }
    },
    [projectId, resetPendingSessionCreate, onClose, navigate],
  )

  const handleSkip = useCallback(() => handleCreate(undefined), [handleCreate])
  const handleCreateWithWorktree = useCallback(() => handleCreate(worktreeName.trim()), [handleCreate, worktreeName])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-lg border border-border shadow-xl p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {creating ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : !gitInfo ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-2">New Session</h2>
            <p className="text-sm text-text-muted mb-4">
              Create in a git worktree? This lets you run multiple sessions in parallel without conflicts. Current
              branch: <span className="font-mono text-text-secondary">{gitInfo.branch}</span>
            </p>
            {error && <p className="text-sm text-accent-error mb-3 bg-accent-error/10 p-2 rounded">{error}</p>}
            <label className="block text-sm text-text-secondary mb-1">Worktree name</label>
            <input
              type="text"
              value={worktreeName}
              onChange={(e) => setWorktreeName(e.target.value)}
              placeholder="feature/my-branch"
              className="w-full px-3 py-2 rounded border border-border bg-bg-primary text-text-primary text-sm mb-4 focus:outline-none focus:border-accent-primary"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleSkip}
                className="px-4 py-2 text-sm rounded bg-bg-tertiary text-text-secondary hover:bg-bg-secondary transition-colors"
              >
                Create in project folder
              </button>
              <button
                onClick={handleCreateWithWorktree}
                disabled={!worktreeName.trim() || creating}
                className="px-4 py-2 text-sm rounded bg-accent-primary text-white hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create in new worktree
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
