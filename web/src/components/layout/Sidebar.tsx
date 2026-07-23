import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useLocation, Link } from 'wouter'
import { useSessionStore } from '../../stores/session'
import type { PendingPathConfirmation } from '../../stores/session/types'
import { useProjectStore } from '../../stores/project'
import type { SessionSummary } from '@shared/types.js'
import { ProjectSettingsModal } from '../settings/ProjectSettingsModal'
import { DropdownMenu } from '../shared/DropdownMenu'
import { CloseButton } from '../shared/CloseButton'
import { ConfirmModal } from '../shared/ConfirmModal'
import { Modal } from '../shared/Modal'
import { ModalFooter } from '../shared/ModalFooter'
import { EllipsisIcon, SpinIcon, StopIcon, SearchIcon, XCloseIcon } from '../shared/icons'
import { groupSessionsByDate, formatDateHeader, formatTime } from '../../lib/format-date.js'
import { fuzzyMatch, highlightMatches } from '../../lib/modal-utils.js'
import { useBinding, useKeybindings } from '../../hooks/useKeybindings.js'

interface SidebarProps {
  projectId: string
  isOpen?: boolean
  onClose?: () => void
}

export function Sidebar({ projectId, isOpen = true, onClose }: SidebarProps) {
  const [, navigate] = useLocation()
  const [showSettings, setShowSettings] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null)
  const [sessionToRename, setSessionToRename] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showDeleteAll, setShowDeleteAll] = useState(false)

  const sessions = useSessionStore((state) => state.sessions)
  const currentSession = useSessionStore((state) => state.currentSession)
  const unreadSessionIds = useSessionStore((state) => state.unreadSessionIds)
  const deleteSession = useSessionStore((state) => state.deleteSession)
  const deleteAllSessions = useSessionStore((state) => state.deleteAllSessions)
  const loadMoreSessions = useSessionStore((state) => state.loadMoreSessions)
  const sessionsHasMore = useSessionStore((state) => state.sessionsHasMore)
  const sessionsPaginationLoading = useSessionStore((state) => state.sessionsPaginationLoading)
  const sessionsWithPendingConfirmations = useSessionStore((state) => state.sessionsWithPendingConfirmations)
  const pendingPathConfirmations = useSessionStore((state) => state.pendingPathConfirmations)

  const currentProject = useProjectStore((state) => state.currentProject)

  const [searchQuery, setSearchQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const searchRef = useRef<HTMLInputElement>(null)
  const sessionListRef = useRef<HTMLDivElement>(null)

  const wasAutoOpenedRef = useRef(false)

  const keybindings = useKeybindings()
  useBinding(keybindings.sessionSearch, () => {
    if (isOpen && document.activeElement === searchRef.current) {
      onClose?.()
      return
    }
    if (!isOpen) {
      wasAutoOpenedRef.current = true
      onClose?.()
    }
    searchRef.current?.focus()
  })

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
      { threshold: 0.1 },
    )

    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [sessionsHasMore, handleLoadMore])

  // Filter sessions to those belonging to the current project by ID
  const projectSessions = sessions.filter((session) => session.projectId === currentProject?.id)

  const filteredSessions = useMemo(() => {
    if (!searchQuery) return projectSessions
    return projectSessions.filter((s) => {
      const title = s.title ?? ''
      const promptsJoined = (s.recentUserPrompts?.map((p) => p.content) ?? []).join(' ')
      return fuzzyMatch(title, searchQuery) || fuzzyMatch(promptsJoined, searchQuery)
    })
  }, [projectSessions, searchQuery])

  const isSearching = searchQuery.length > 0
  const hasNoResults = isSearching && filteredSessions.length === 0

  // Reset focused index when search results change
  useEffect(() => {
    setFocusedIndex(filteredSessions.length > 0 ? 0 : -1)
  }, [filteredSessions.length])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0) return
    const el = sessionListRef.current?.querySelector(`[data-sidx="${focusedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex])

  const handleDeleteSession = (sessionId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSessionToDelete(sessionId)
  }

  const handleConfirmDeleteSession = () => {
    if (!sessionToDelete) return
    deleteSession(sessionToDelete)
    if (currentSession?.id === sessionToDelete) {
      navigate(`/p/${projectId}`)
    }
    setSessionToDelete(null)
  }

  const handleRenameSession = (sessionId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const session = sessions.find((s) => s.id === sessionId)
    const currentTitle = session?.title ?? sessionId.slice(0, 6)
    setRenameValue(currentTitle)
    setSessionToRename(sessionId)
  }

  const handleConfirmRename = () => {
    if (!sessionToRename || renameValue.trim() === '') return
    const renameSession = useSessionStore.getState().renameSession
    renameSession(sessionToRename, renameValue.trim())
    setSessionToRename(null)
    setRenameValue('')
  }

  const handleDeleteAllSessions = () => {
    setShowDeleteAll(true)
  }

  const handleConfirmDeleteAll = () => {
    deleteAllSessions(projectId)
    navigate(`/p/${projectId}`)
    setShowDeleteAll(false)
  }

  const handleSessionListClick = (e: React.MouseEvent) => {
    if (!wasAutoOpenedRef.current) return
    const link = (e.target as HTMLElement).closest('a[href*="/s/"]')
    if (link) {
      wasAutoOpenedRef.current = false
      onClose?.()
    }
  }

  const handleClearSearch = () => {
    setSearchQuery('')
    searchRef.current?.focus()
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        setSearchQuery('')
        searchRef.current?.blur()
        break
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex((prev) => (prev < filteredSessions.length - 1 ? prev + 1 : prev))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0))
        break
      case 'Enter': {
        e.preventDefault()
        const session = filteredSessions[focusedIndex]
        if (session) {
          navigate(`/p/${projectId}/s/${session.id}`)
          if (wasAutoOpenedRef.current) {
            wasAutoOpenedRef.current = false
            onClose?.()
          }
        }
        break
      }
    }
  }

  return (
    <>
      {/* Mobile/tablet backdrop */}
      {isOpen && onClose && <div className="md:hidden fixed inset-0 bg-black/50 z-40" onClick={onClose} />}

      <aside
        className={`
          ${isOpen ? 'md:w-[300px] md:shrink-0' : 'md:w-0 md:shrink-0 md:overflow-hidden'}
          md:relative md:h-auto md:translate-x-0

          fixed z-50 h-[calc(100vh-32px)]
          w-[300px] bg-secondary border-r border-border flex flex-col
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
          {onClose && <CloseButton onClick={onClose} className="md:hidden" variant="sidebar" size="md" />}
        </div>

        {/* Search bar */}
        <div className="px-4 py-2 border-b border-border">
          <div className="relative flex items-center">
            <SearchIcon className="absolute left-2.5 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search sessions..."
              className="w-full bg-bg-tertiary border border-border rounded pl-8 pr-8 py-1.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary/50 focus:border-accent-primary transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-1.5 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                aria-label="Clear search"
              >
                <XCloseIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {isSearching && !hasNoResults && (
            <div className="mt-1 text-xs text-text-muted px-1">
              {filteredSessions.length} {filteredSessions.length === 1 ? 'match' : 'matches'}
            </div>
          )}
        </div>

        {/* Project Settings Modal */}
        {currentProject && (
          <ProjectSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} project={currentProject} />
        )}

        <ConfirmModal
          isOpen={sessionToDelete !== null}
          onClose={() => setSessionToDelete(null)}
          onConfirm={handleConfirmDeleteSession}
          title="Delete session?"
          message="This session will be permanently deleted."
          confirmLabel="Delete session"
          confirmVariant="danger"
        />

        <ConfirmModal
          isOpen={showDeleteAll}
          onClose={() => setShowDeleteAll(false)}
          onConfirm={handleConfirmDeleteAll}
          title="Delete all sessions?"
          message="Delete all sessions in this project? This cannot be undone."
          confirmLabel="Delete all"
          confirmVariant="danger"
        />

        <Modal
          isOpen={sessionToRename !== null}
          onClose={() => {
            setSessionToRename(null)
            setRenameValue('')
          }}
          title="Rename session"
          size="sm"
          footer={
            <ModalFooter
              onCancel={() => {
                setSessionToRename(null)
                setRenameValue('')
              }}
              onSave={handleConfirmRename}
              saving={false}
              saveDisabled={renameValue.trim() === ''}
              saveLabel="Rename"
            />
          }
        >
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirmRename()
            }}
            onFocus={(e) => e.target.select()}
            className="w-full px-3 py-2 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent-primary"
            autoFocus
          />
        </Modal>

        <div className="flex-1 overflow-y-auto scrollbar-stable">
          {filteredSessions.length === 0 ? (
            <div className="p-4 text-center text-text-muted text-xs">
              {isSearching ? 'No matching sessions' : 'No sessions'}
            </div>
          ) : (
            <>
              <div className="divide-y divide-border" ref={sessionListRef} onClick={handleSessionListClick}>
                {renderSessionGroups(
                  filteredSessions,
                  currentSession,
                  unreadSessionIds,
                  handleDeleteSession,
                  handleRenameSession,
                  projectId,
                  sessionsWithPendingConfirmations,
                  pendingPathConfirmations,
                  searchQuery,
                  focusedIndex,
                )}
              </div>
              {sessionsPaginationLoading && (
                <div className="p-4 text-center text-text-muted text-xs">Loading more...</div>
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
  handleRenameSession: (sessionId: string, e?: React.MouseEvent) => void,
  projectId: string,
  sessionsWithPendingConfirmations: string[],
  pendingPathConfirmations: PendingPathConfirmation[],
  searchQuery: string,
  focusedIndex: number,
) {
  const groups = groupSessionsByDate(projectSessions)

  let flatIdx = 0

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
        {daySessions.map((session) => {
          const idx = flatIdx++
          const isActive = currentSession?.id === session.id
          const isFocused = idx === focusedIndex
          const hasUnread = unreadSessionIds.includes(session.id)
          const isRunning = session.isRunning
          const hasPendingConfirmation =
            sessionsWithPendingConfirmations.includes(session.id) || (isActive && pendingPathConfirmations.length > 0)
          return (
            <div
              key={session.id}
              data-sidx={idx}
              className={`w-full px-4 py-3 text-left hover:bg-bg-tertiary/50 transition-colors group ${
                isActive ? 'bg-bg-tertiary' : ''
              } ${isFocused ? 'bg-accent-primary/10' : ''}`}
            >
              <Link
                href={`/p/${projectId}/s/${session.id}`}
                className={`block ${isActive ? 'text-accent-primary' : 'text-text-primary'} hover:text-accent-primary`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span
                    className={`font-medium truncate text-sm ${isActive ? 'text-accent-primary' : 'text-text-primary'}`}
                  >
                    {searchQuery
                      ? highlightMatches(session.title ?? session.id.slice(0, 6), searchQuery)
                      : (session.title ?? session.id.slice(0, 6))}
                  </span>
                  <DropdownMenu
                    items={[
                      {
                        label: 'Rename session',
                        onClick: (e?: React.MouseEvent) => handleRenameSession(session.id, e),
                      },
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
                  {hasPendingConfirmation ? (
                    <span title="Awaiting confirmation">
                      <StopIcon className="w-3 h-3 text-red-400 flex-shrink-0" />
                    </span>
                  ) : isRunning ? (
                    <SpinIcon />
                  ) : hasUnread && !isActive ? (
                    <span
                      aria-label="Unread activity"
                      title="Unread activity"
                      className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0"
                    />
                  ) : null}
                  {/* Time in muted style */}
                  <span className="text-text-muted text-xs flex-shrink-0">{formatTime(session.updatedAt)}</span>
                  {/* Message count in muted style */}
                  <span className="text-text-muted text-xs flex-shrink-0">{session.messageCount} messages</span>
                </div>
              </Link>
            </div>
          )
        })}
      </div>
    )
  })
}
