import { useEffect } from 'react'
import { branchResource } from '../lib/resources'
import { useResource } from './useResource'

/**
 * Current git branch for a workdir, polled every 3s. The resource cache keeps
 * the value shareable; the interval only refreshes the owning key.
 */
export function useCurrentBranch(workdir?: string) {
  const { data, loading, error, refresh } = useResource(branchResource, workdir ?? '')

  useEffect(() => {
    if (!workdir) return
    const pollTimer = setInterval(() => {
      void refresh()
    }, 3000)
    return () => clearInterval(pollTimer)
  }, [workdir, refresh])

  return {
    branch: workdir ? (data?.branch ?? null) : null,
    loading,
    error: error ? (error instanceof Error ? error.message : 'Failed to fetch branch') : null,
  }
}
