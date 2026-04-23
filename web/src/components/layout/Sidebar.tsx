import { useEffect, useRef, useState, useCallback } from 'react'
import { useLocation, Link } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { useProjectStore } from '../../stores/project'
import type { SessionSummary } from '@shared/types.js'
import { ProjectSettingsModal } from '../settings/ProjectSettingsModal'
import { DropdownMenu } from '../shared/DropdownMenu'
import { CloseButton } from '../shared/CloseButton'
import { EllipsisIcon, SpinIcon } from '../shared/icons'
import { groupSessionsByDate, formatDateHeader, formatTime } from '../../lib/format-date.js'

interface SidebarProps {
  projectId: string
  isOpen?: boolean
  onClose?: () => void
}

export function Sidebar({ projectId, isOpen = true, onClose }: SidebarProps) {
  const [, navigate] = useLocation()
  const [showSettings, setShowSettings] = useState(false)

  const sessions = useSessionStore(state => state.sessions)
  const currentSession = useSessionStore(state => state.currentSession)
  const unreadSessionIds = useSessionStore(state => state.unreadSessionIds)
  const deleteSession = useSessionStore(state => state.deleteSession)
  const deleteAllSessions = useSessionStore(state => state.deleteAllSessions)
  const loadMoreSessions = useSessionStore(state => state.loadMoreSessions)
  const sessionsHasMore = useSessionStore(state => state.sessionsHasMore)
  const sessionsPaginationLoading = useSessionStore(state => state.sessionsPaginationLoading)

  const currentProject = useProjectStore(state => state.currentProject)

  const loadMoreRef = useRef<HTMLDivElement>(null)

  const handleLoadMore = useCallback(() => {
    if (sessionsHasMore && !sessionsPaginationLoading && currentProject) {
      loadMoreSessions(currentProject.id)
    }
  }, [sessionsHasMore, sessionsPaginationLoading, currentProject, loadMoreSessions])

  useEffect(() => {
    if (!loadMoreRef.current || !sessionsHasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry && entry.isIntersecting) {
          handleLoadMore()
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [sessionsHasMore, handleLoadMore])

  // Filter sessions to those belonging to the current project by ID
  const projectSessions = sessions.filter(session => session.projectId === currentProject?.id)

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
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          ${isOpen ? 'md:w-[300px] md:shrink-0' : 'md:w-0 md:shrink-0 md:overflow-hidden'}
          md:relative md:h-auto md:translate-x-0

          fixed z-50 h-[calc(100vh-32px)]
          w-[300px] bg-secondary border-r border-border flex flex-col
          transition-all duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="p-4 border-b border-border flex gap-2">
          <Link
            href={`/p/${projectId}/new`}
            className="flex-1 block text-center rounded font-medium transition-colors bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 px-3 py-1.5 text-sm"
            data-testid="sidebar-new-session-button"
          >
            + New Session
          </Link>
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
                <EllipsisIcon />
              </button>
            }
          />
          {/* Mobile close button */}
          {onClose && (
            <CloseButton
              onClick={onClose}
              className="md:hidden"
              variant="sidebar"
              size="md"
            />
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
            <>
              <div className="divide-y divide-border">
                {renderSessionGroups(projectSessions, currentSession, unreadSessionIds, handleDeleteSession, projectId)}
              </div>
              {sessionsPaginationLoading && (
                <div className="p-4 text-center text-text-muted text-xs">
                  Loading more...
                </div>
              )}
              <div ref={loadMoreRef} className="h-px" />
            </>
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
  handleDeleteSession: (sessionId: string, e?: React.MouseEvent) => void,
  projectId: string,
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
              className={`w-full px-4 py-3 text-left hover:bg-bg-tertiary/50 transition-colors group ${
                isActive ? 'bg-bg-tertiary' : ''
              }`}
            >
              <Link
                href={`/p/${projectId}/s/${session.id}`}
                className={`block ${isActive ? 'text-accent-primary' : 'text-text-primary'} hover:text-accent-primary`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className={`font-medium truncate text-sm ${isActive ? 'text-accent-primary' : 'text-text-primary'}`}>
                    {session.title ?? session.id.slice(0, 6)}
                  </span>
                  <DropdownMenu
                    items={[
                      {
                        label: 'Delete session',
                        onClick: (e?: React.MouseEvent) => handleDeleteSession(session.id, e),
                        danger: true,
                      },
                    ]}
                    trigger={
                      <button
                        onClick={(e) => e.preventDefault()}
                        className="p-1.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-all"
                        title="Options"
                      >
                        <EllipsisIcon />
                      </button>
                    }
                  />
                </div>
                {/* Time displayed below the title as muted secondary text */}
                <div className="flex items-center gap-2 mt-1">
                  {isRunning ? (
                    <SpinIcon />
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
                  {/* Message count in muted style */}
                  <span className="text-text-muted text-xs flex-shrink-0">
                    {session.messageCount} messages
                  </span>
                </div>
              </Link>
            </div>
          )
        })}
      </div>
    )
  })
}
