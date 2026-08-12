import { useEffect, useState } from 'react'
import { useScopedContext, useScopedPaneState } from '../stores/session/session-scope'

interface GitDiffFile {
  path: string
  status: 'modified' | 'added' | 'deleted'
  additions: number
  deletions: number
}

interface UseGitStatusResult {
  branch: string | null
  diff: {
    files: GitDiffFile[]
    loading: boolean
    error: string | null
  }
}

export function useGitStatus(): UseGitStatusResult {
  const { sessionId, currentSession } = useScopedContext()
  const gitStatus = useScopedPaneState(
    sessionId,
    (pane) => pane.gitStatus,
    (state) => state.gitStatus,
    null,
  )
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (currentSession?.workdir) {
      setLoading(false)
    }
  }, [currentSession?.workdir])

  return {
    branch: gitStatus?.branch ?? null,
    diff: {
      files: gitStatus?.diff?.files ?? [],
      loading,
      error: null,
    },
  }
}
