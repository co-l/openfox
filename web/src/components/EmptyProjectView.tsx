import { useEffect } from 'react'
import { useLocation } from 'wouter'
import { useProjectStore } from '../stores/project'
import { useSessionStore } from '../stores/session'
import { Button } from './shared/Button'

export function EmptyProjectView() {
  const [, navigate] = useLocation()
  const currentProject = useProjectStore(state => state.currentProject)
  const createSession = useSessionStore(state => state.createSession)
  const pendingSessionCreate = useSessionStore(state => state.pendingSessionCreate)
  const resetPendingSessionCreate = useSessionStore(state => state.resetPendingSessionCreate)
  
  const handleCreateSession = () => {
    if (currentProject) {
      createSession(currentProject.id)
    }
  }

  // Navigate to the new session when server confirms creation.
  // pendingSessionCreate transitions: false → true (waiting) → sessionId (ready) → false (done)
  useEffect(() => {
    if (typeof pendingSessionCreate === 'string' && currentProject) {
      navigate(`/p/${currentProject.id}/s/${pendingSessionCreate}`)
      resetPendingSessionCreate()
    }
  }, [pendingSessionCreate, currentProject, navigate, resetPendingSessionCreate])
  
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center">
      <div className="max-w-md">
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          {currentProject?.name ?? 'Project'}
        </h2>
        <p className="text-text-secondary mb-6">
          No session selected
        </p>
        <div className="flex flex-col gap-3">
          <Button
            variant="primary"
            className="w-full"
            onClick={handleCreateSession}
          >
            Create New Session
          </Button>
          <p className="text-sm text-text-muted">
            Or select an existing session from the sidebar
          </p>
        </div>
      </div>
    </div>
  )
}
