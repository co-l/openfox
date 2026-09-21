import { useEffect } from 'react'
import { useSessionStore } from '../stores/session'
import { useProjectStore } from '../stores/project'

interface UseProjectLoaderOptions {
  canLoad: boolean
  projectId: string | undefined
  currentProjectId: string | undefined
}

export function useProjectLoader({ canLoad, projectId, currentProjectId }: UseProjectLoaderOptions) {
  const setCurrentProjectId = useProjectStore((state) => state.setCurrentProjectId)
  const listSessions = useSessionStore((state) => state.listSessions)
  const clearSession = useSessionStore((state) => state.clearSession)

  useEffect(() => {
    if (canLoad && projectId) {
      if (currentProjectId !== projectId) {
        // Local UI state only — the project detail loads implicitly via
        // useCurrentProject()'s resource subscription.
        setCurrentProjectId(projectId)
      }
      listSessions(projectId)
      clearSession()
    }
  }, [canLoad, projectId, currentProjectId, setCurrentProjectId, listSessions, clearSession])
}
