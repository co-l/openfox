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
  const setCurrentProjectId = useProjectStore((state) => state.setCurrentProjectId)
  const listSessions = useSessionStore((state) => state.listSessions)
  const pendingSessionCreate = useSessionStore((state) => state.pendingSessionCreate)

  useEffect(() => {
    if (canLoad && projectId && currentProjectId !== projectId) {
      // Local UI state only — the project detail loads implicitly via
      // useCurrentProject()'s resource subscription.
      setCurrentProjectId(projectId)
    }
  }, [canLoad, projectId, currentProjectId, setCurrentProjectId])

  useEffect(() => {
    if (canLoad && sessionId && currentSessionId !== sessionId) {
      loadSession(sessionId)
    }
    if (canLoad && projectId) {
      listSessions(projectId)
    }
  }, [canLoad, sessionId, currentSessionId, loadSession, listSessions, pendingSessionCreate, projectId])
}
