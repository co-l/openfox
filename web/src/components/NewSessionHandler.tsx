import { useEffect } from 'react'
import { useRoute, useLocation } from 'wouter'
import { useSessionStore } from '../stores/session'
import { Spinner } from './shared/Spinner'

export function NewSessionHandler() {
  const [, params] = useRoute('/p/:projectId/new')
  const [, navigate] = useLocation()
  const projectId = params?.projectId

  const createSession = useSessionStore((state) => state.createSession)

  useEffect(() => {
    if (projectId) {
      const createAndRedirect = async () => {
        const session = await createSession(projectId)
        if (session) {
          window.location.href = `/p/${projectId}/s/${session.id}`
        } else {
          navigate(`/p/${projectId}`)
        }
      }
      createAndRedirect()
    }
  }, [projectId, createSession, navigate])

  return (
    <div className="flex-1 flex items-center justify-center">
      <Spinner />
    </div>
  )
}