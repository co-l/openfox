import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { useProjectStore } from '../../stores/project'
import { Button } from '../shared/Button'
import { ProjectSettingsModal } from '../settings/ProjectSettingsModal'

interface SidebarProps {
  projectId: string
  isOpen?: boolean
  onClose?: () => void
}

export function Sidebar({ projectId, isOpen = true, onClose }: SidebarProps) {
  const [, navigate] = useLocation()
  const pendingNewSession = useRef(false)
  const [showSettings, setShowSettings] = useState(false)

  const sessions = useSessionStore(state => state.sessions)
  const currentSession = useSessionStore(state => state.currentSession)
  const unreadSessionIds = useSessionStore(state => state.unreadSessionIds)
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
    // Close sidebar on mobile after selection
    if (onClose) onClose()
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
    <>
      {/* Mobile/tablet backdrop */}
      {isOpen && onClose && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed md:relative z-50 md:z-auto
          w-[200px] bg-bg-secondary border-r border-border flex flex-col
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          h-[calc(100vh-32px)] md:h-auto
        `}
      >
        <div className="p-4 border-b border-border flex gap-2">
          <Button
            variant="primary"
            className="flex-1 text-sm"
            onClick={handleNewSession}
          >
            + New Session
          </Button>
          <button
            onClick={() => setShowSettings(true)}
            className="flex-shrink-0 p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Project Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          {/* Mobile close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden flex-shrink-0 p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
              title="Close sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Project Settings Modal */}
        {currentProject && (
          <ProjectSettingsModal
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
            project={currentProject}
          />
        )}

        <div className="flex-1 overflow-y-auto">
          {projectSessions.length === 0 ? (
            <div className="p-4 text-center text-text-muted text-xs">
              No sessions
            </div>
          ) : (
            <div className="divide-y divide-border">
              {projectSessions.map(session => {
                const isActive = currentSession?.id === session.id
                const hasUnread = unreadSessionIds.includes(session.id)
                const isRunning = session.isRunning && session.phase !== 'done' && session.phase !== 'blocked'
                return (
                  <div
                    key={session.id}
                    onClick={() => handleSelectSession(session.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-bg-tertiary/50 transition-colors group cursor-pointer ${
                      isActive ? 'bg-bg-tertiary' : ''
                    }`}
                  >
                    <div className="flex">
                      <span className={`font-medium truncate text-sm ${isActive ? 'text-accent-primary' : 'text-text-primary'}`}>
                        {session.title ?? session.id.slice(0, 6)}
                      </span>
                    </div>

                    <div className="flex right">
                      {isRunning && (
                        <svg
                          aria-label="Session running"
                          className="w-3 h-3 text-blue-400 animate-spin flex-shrink-0"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <title>Running</title>
                          <circle className="opacity-30" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
                          <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                      )}
                      {hasUnread && !isActive && !isRunning && (
                        <span
                          aria-label="Unread activity"
                          title="Unread activity"
                          className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0"
                        />
                      )}

                      <button
                        onClick={(e) => handleDeleteSession(session.id, e)}
                        className=" float-right p-2.5 rounded hover:bg-accent-error/20 text-text-muted hover:text-accent-error transition-all"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}