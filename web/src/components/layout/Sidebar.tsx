import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { useProjectStore } from '../../stores/project'
import type { SessionSummary } from '../../../src/shared/types.js'
import { Button } from '../shared/Button'
import { ProjectSettingsModal } from '../settings/ProjectSettingsModal'
import { DropdownMenu } from '../shared/DropdownMenu'
import { groupSessionsByDate, formatDateHeader, formatTime } from '../../lib/format-date.js'

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
  const deleteAllSessions = useSessionStore(state => state.deleteAllSessions)
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

  const handleDeleteSession = (sessionId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (confirm('Delete this session?')) {
      deleteSession(sessionId)
      // If deleting current session, navigate to project root
      if (currentSession?.id === sessionId) {
        navigate(`/p/${projectId}`)
      }
    }
  }

  const handleDeleteAllSessions = () => {
    if (confirm('Delete all sessions in this project? This cannot be undone.')) {
      deleteAllSessions(projectId)
      navigate(`/p/${projectId}`)
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

          xl:relative xl:z-auto xl:translate-x-0 xl:h-auto

          fixed z-50 -translate-x-full h-[calc(100vh-32px)]

          w-[300px] bg-bg-secondary border-r border-border flex flex-col
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : ''}
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
          <DropdownMenu
            items={[
              {
                label: 'Edit project settings',
                onClick: () => setShowSettings(true),
              },
              {
                label: 'Delete all sessions',
                onClick: handleDeleteAllSessions,
                danger: true,
              },
            ]}
            trigger={
              <button
                className="flex-shrink-0 p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
                title="Options"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
            }
          />
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
              {renderSessionGroups(projectSessions, currentSession, unreadSessionIds, handleSelectSession, handleDeleteSession)}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

function renderSessionGroups(
  projectSessions: SessionSummary[],
  currentSession: { id: string | null } | null,
  unreadSessionIds: string[],
  handleSelectSession: (sessionId: string) => void,
  handleDeleteSession: (sessionId: string, e?: React.MouseEvent) => void,
) {
  const groups = groupSessionsByDate(projectSessions)
  
  return Array.from(groups).map(([dateKey, daySessions]) => {
    const firstSession = daySessions[0]
    if (!firstSession) return null
    
    return (
      <div key={dateKey}>
        {/* Date header */}
        <div className="px-4 py-2 bg-bg-tertiary/30 text-text-muted text-xs font-medium">
          {formatDateHeader(firstSession.updatedAt)}
        </div>
        
        {/* Sessions for this day */}
        {daySessions.map(session => {
          const isActive = currentSession?.id === session.id
          const hasUnread = unreadSessionIds.includes(session.id)
          const isRunning = session.isRunning
          return (
            <div
              key={session.id}
              onClick={() => handleSelectSession(session.id)}
              className={`w-full px-4 py-3 text-left hover:bg-bg-tertiary/50 transition-colors group cursor-pointer ${
                isActive ? 'bg-bg-tertiary' : ''
              }`}
            >
              <div className="flex justify-between items-center mb-1">
                <span className={`font-medium truncate text-sm ${isActive ? 'text-accent-primary' : 'text-text-primary'}`}>
                  {session.title ?? session.id.slice(0, 6)}
                </span>
                <DropdownMenu
                  items={[
                    {
                      label: 'Delete session',
                      onClick: (e: React.MouseEvent) => handleDeleteSession(session.id, e),
                      danger: true,
                    },
                  ]}
                  trigger={
                    <button
                      className="p-1.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-all"
                      title="Options"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="5" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="12" cy="19" r="2" />
                      </svg>
                    </button>
                  }
                />
              </div>
              {/* Time displayed below the title as muted secondary text */}
              <div className="flex items-center gap-2 mt-1">
                {isRunning ? (
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
                ) : hasUnread && !isActive ? (
                  <span
                    aria-label="Unread activity"
                    title="Unread activity"
                    className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0"
                  />
                ) : null}
                {/* Time in muted style */}
                <span className="text-text-muted text-xs flex-shrink-0">
                  {formatTime(session.updatedAt)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    )
  })
}
