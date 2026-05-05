import { useEffect } from 'react'
import { useSessionStore } from '../stores/session'
import { useProjectStore } from '../stores/project'

interface UseSessionLoaderOptions {
  canLoad: boolean
  projectId: string | undefined
  sessionId: string | undefined
  currentProjectId: string | undefined
  currentSessionId: string | undefined
}

export function useSessionLoader({
  canLoad,
  projectId,
  sessionId,
  currentProjectId,
  currentSessionId,
}: UseSessionLoaderOptions) {
  const loadSession = useSessionStore((state) => state.loadSession)
  const loadProject = useProjectStore((state) => state.loadProject)
  const listSessions = useSessionStore((state) => state.listSessions)
  const pendingSessionCreate = useSessionStore((state) => state.pendingSessionCreate)

  useEffect(() => {
    if (canLoad && projectId && currentProjectId !== projectId) {
      loadProject(projectId)
    }
  }, [canLoad, projectId, currentProjectId, loadProject])

  useEffect(() => {
    if (canLoad && sessionId && currentSessionId !== sessionId) {
      loadSession(sessionId)
    }
    if (canLoad && projectId) {
      listSessions(projectId)
    }
  }, [canLoad, sessionId, currentSessionId, loadSession, listSessions, pendingSessionCreate, projectId])
}