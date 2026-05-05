import { useCallback, useEffect } from 'react'
import { useRoute, useLocation } from 'wouter'
import { useSessionStore } from '../stores/session'
import { Spinner } from './shared/Spinner'

export function NewSessionHandler() {
  const [, params] = useRoute('/p/:projectId/new')
  const [, navigate] = useLocation()
  const projectId = params?.projectId

  const createSession = useSessionStore((state) => state.createSession)
  const resetPendingSessionCreate = useSessionStore((state) => state.resetPendingSessionCreate)

  const createAndRedirect = useCallback(async () => {
    if (!projectId) return
    const session = await createSession(projectId)
    if (session) {
      navigate(`/p/${projectId}/s/${session.id}`)
      resetPendingSessionCreate()
    } else {
      navigate(`/p/${projectId}`)
      resetPendingSessionCreate()
    }
  }, [projectId, createSession, navigate, resetPendingSessionCreate])

  useEffect(() => {
    createAndRedirect()
  }, [createAndRedirect])

  return (
    <div className="flex-1 flex items-center justify-center">
      <Spinner />
    </div>
  )
}
