import { useEffect, useRef } from 'react'
import { useLocation } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { useProjectStore } from '../../stores/project'
import { useConfigStore } from '../../stores/config'
import { Button } from '../shared/Button'

interface SidebarProps {
  projectId: string
}

export function Sidebar({ projectId }: SidebarProps) {
  const [, navigate] = useLocation()
  const pendingNewSession = useRef(false)
  
  const sessions = useSessionStore(state => state.sessions)
  const currentSession = useSessionStore(state => state.currentSession)
  const createSession = useSessionStore(state => state.createSession)
  const deleteSession = useSessionStore(state => state.deleteSession)
  const listSessions = useSessionStore(state => state.listSessions)
  
  const currentProject = useProjectStore(state => state.currentProject)
  const maxContext = useConfigStore(state => state.maxContext)
  
  // Filter sessions to those under project workdir
  const projectSessions = sessions.filter(session => {
    if (!currentProject) return false
    return session.workdir.startsWith(currentProject.workdir)
  })
  
  // Navigate to new session when created
  useEffect(() => {
    if (pendingNewSession.current && currentSession) {
      pendingNewSession.current = false
      listSessions() // Refresh the list
      navigate(`/p/${projectId}/s/${currentSession.id}`)
    }
  }, [currentSession, projectId, navigate, listSessions])
  
  const handleNewSession = () => {
    pendingNewSession.current = true
    createSession(projectId)
  }
  
  const handleSelectSession = (sessionId: string) => {
    navigate(`/p/${projectId}/s/${sessionId}`)
  }
  
  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('Delete this session?')) {
      deleteSession(sessionId)
      // If deleting current session, navigate to project root
      if (currentSession?.id === sessionId) {
        navigate(`/p/${projectId}`)
      }
    }
  }
  
  return (
    <aside className="w-60 bg-bg-secondary border-r border-border flex flex-col">
      {/* New Session Button */}
      <div className="p-3 border-b border-border">
        <Button
          variant="primary"
          className="w-full"
          onClick={handleNewSession}
        >
          + New Session
        </Button>
      </div>
      
      {/* Session List */}
      <div className="flex-1 overflow-y-auto">
        {projectSessions.length === 0 ? (
          <div className="p-4 text-center text-text-muted text-sm">
            No sessions yet
          </div>
        ) : (
          <div className="divide-y divide-border">
            {projectSessions.map(session => {
              const isActive = currentSession?.id === session.id
              return (
                <div
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={`w-full p-3 text-left hover:bg-bg-tertiary/50 transition-colors group cursor-pointer ${
                    isActive ? 'bg-bg-tertiary' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-primary flex-shrink-0" />
                    )}
                    <span className={`font-medium truncate ${isActive ? 'text-accent-primary' : 'text-text-primary'}`}>
                      {session.title ?? `Session ${session.id.slice(0, 6)}`}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      session.mode === 'planner'
                        ? 'bg-purple-500/20 text-purple-400'
                        : session.mode === 'builder'
                        ? 'bg-blue-500/20 text-blue-400'
                        : session.mode === 'verifier'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-bg-tertiary text-text-muted'
                    }`}>
                      {session.mode}
                      {session.isRunning && ' •'}
                    </span>
                    
                    <button
                      onClick={(e) => handleDeleteSession(session.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-accent-error/70 hover:text-accent-error p-1 transition-opacity"
                      title="Delete session"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  
                  {session.criteriaCount > 0 && (
                    <div className="text-xs text-text-muted mt-1">
                      {session.criteriaCompleted}/{session.criteriaCount} criteria
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      
      {/* Context Usage */}
      {currentSession?.executionState && (
        <div className="p-3 border-t border-border">
          {(() => {
            const contextUsed = currentSession.executionState.currentTokenCount
            const contextPercent = Math.round((contextUsed / maxContext) * 100)
            return (
              <>
                <div className="flex justify-between text-xs text-text-muted mb-1">
                  <span>Context</span>
                  <span>{contextPercent}%</span>
                </div>
                <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      contextPercent > 85 ? 'bg-accent-error' :
                      contextPercent > 60 ? 'bg-accent-warning' :
                      'bg-accent-success'
                    }`}
                    style={{ width: `${Math.min(contextPercent, 100)}%` }}
                  />
                </div>
              </>
            )
          })()}
        </div>
      )}
      
    </aside>
  )
}
