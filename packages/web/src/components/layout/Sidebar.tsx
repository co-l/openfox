import { useEffect, useRef } from 'react'
import { useLocation } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { useProjectStore } from '../../stores/project'
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
    <aside className="w-[200px] bg-bg-secondary border-r border-border flex flex-col">
      <div className="p-2 border-b border-border">
        <Button
          variant="primary"
          className="w-full text-xs px-2 py-1"
          onClick={handleNewSession}
        >
          + New
        </Button>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {projectSessions.length === 0 ? (
          <div className="p-2 text-center text-text-muted text-xs">
            No sessions
          </div>
        ) : (
          <div className="divide-y divide-border">
            {projectSessions.map(session => {
              const isActive = currentSession?.id === session.id
              return (
                <div
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={`w-full p-2 text-left hover:bg-bg-tertiary/50 transition-colors group cursor-pointer ${
                    isActive ? 'bg-bg-tertiary' : ''
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {isActive && (
                      <span className="w-1 h-1 rounded-full bg-accent-primary flex-shrink-0" />
                    )}
                    <span className={`font-medium truncate text-sm ${isActive ? 'text-accent-primary' : 'text-text-primary'}`}>
                      {session.title ?? session.id.slice(0, 6)}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between mt-0.5">
                    <span className={`text-[10px] px-1 py-0.5 rounded flex items-center gap-0.5 ${
                      session.phase === 'done'
                        ? 'bg-green-500/20 text-green-400'
                        : session.phase === 'blocked'
                        ? 'bg-red-500/20 text-red-400'
                        : session.phase === 'verification'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : session.phase === 'build'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-purple-500/20 text-purple-400'
                    }`}>
                      {session.phase === 'done' ? (
                        <>
                          <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          done
                        </>
                      ) : session.phase === 'blocked' ? (
                        <>
                          <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          blocked
                        </>
                      ) : session.phase === 'verification' ? (
                        'verify'
                      ) : (
                        session.phase
                      )}
                      {session.isRunning && session.phase !== 'done' && session.phase !== 'blocked' && ' •'}
                    </span>
                    
                    <button
                      onClick={(e) => handleDeleteSession(session.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-accent-error/70 hover:text-accent-error p-0.5 transition-opacity"
                      title="Delete"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  
                  {session.criteriaCount > 0 && (
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {session.criteriaCompleted}/{session.criteriaCount}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
