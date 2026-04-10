import { useState, useEffect } from 'react'
import { authFetch } from '../lib/api'

interface BranchResponse {
  branch: string | null
  workdir: string
  error?: string
}

export function useCurrentBranch(workdir?: string) {
  const [branch, setBranch] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Use provided workdir or empty string (will skip fetching)
  const resolvedWorkdir = workdir || ''

  useEffect(() => {
    // Skip if no workdir provided
    if (!resolvedWorkdir) {
      setLoading(false)
      return
    }

    let mounted = true
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const fetchBranch = async () => {
      try {
        const response = await authFetch(`/api/branch?workdir=${encodeURIComponent(resolvedWorkdir)}`)
        const data: BranchResponse = await response.json()

        if (mounted) {
          setBranch(data.branch)
          setError(data.error || null)
          setLoading(false)
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch branch')
          setLoading(false)
        }
      }
    }

    // Initial fetch
    fetchBranch()

    // Poll every 3 seconds to keep branch info fresh
    pollTimer = setInterval(fetchBranch, 3000)

    return () => {
      mounted = false
      if (pollTimer) {
        clearInterval(pollTimer)
      }
    }
  }, [resolvedWorkdir])

  return { branch, loading, error }
}
