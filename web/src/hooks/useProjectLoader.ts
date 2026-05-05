import { useEffect } from 'react'
import { useSessionStore } from '../stores/session'
import { useProjectStore } from '../stores/project'

interface UseProjectLoaderOptions {
  canLoad: boolean
  projectId: string | undefined
  currentProjectId: string | undefined
}

export function useProjectLoader({ canLoad, projectId, currentProjectId }: UseProjectLoaderOptions) {
  const loadProject = useProjectStore((state) => state.loadProject)
  const listSessions = useSessionStore((state) => state.listSessions)
  const clearSession = useSessionStore((state) => state.clearSession)

  useEffect(() => {
    if (canLoad && projectId) {
      if (currentProjectId !== projectId) {
        loadProject(projectId)
      }
      listSessions(projectId)
      clearSession()
    }
  }, [canLoad, projectId, currentProjectId, loadProject, listSessions, clearSession])
}