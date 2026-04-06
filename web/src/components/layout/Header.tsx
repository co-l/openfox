import { useState, useEffect } from 'react'
import { Link, useLocation } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { useProjectStore } from '../../stores/project'
import { useConfigStore } from '../../stores/config'
import { useTerminalStore } from '../../stores/terminal'
import { GlobalSettingsModal } from '../settings/GlobalSettingsModal'
import { TerminalModal } from '../terminal/TerminalModal'
import { DropdownMenu, DropdownMenuItem } from '../shared/DropdownMenu'
import { groupSessionsByDate, formatDateHeader, formatTime } from '../../lib/format-date'
import type { SessionSummary } from '@shared/types.js'

interface HeaderProps {
  onMenuClick?: () => void
  onCriteriaToggle?: () => void
  hasCriteria?: boolean
}

interface ProjectDropdownProps {
  projects: Array<{ id: string; name: string; workdir: string }>
  currentProject: { id: string; name: string; workdir: string }
}

function ProjectDropdown({ projects, currentProject }: ProjectDropdownProps) {
  const loadProject = useProjectStore(state => state.loadProject)

  const sortedProjects = [...projects].sort((a, b) => a.name.localeCompare(b.name))

  const items: DropdownMenuItem[] = sortedProjects.map(proj => ({
    label: proj.name,
    icon: proj.id === currentProject.id ? (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ) : undefined,
    href: `/p/${proj.id}`,
    onClick: () => {
      loadProject(proj.id)
    },
  }))

  return (
    <DropdownMenu
      items={items}
      trigger={
        <button
          className="text-text-secondary hover:text-text-primary hover:underline text-sm truncate flex items-center gap-1"
          title={currentProject.name}
        >
          {currentProject.name}
          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      }
      minWidth="250px"
    />
  )
}

interface SessionDropdownProps {
  sessions: SessionSummary[]
  currentProject: { id: string; name: string; workdir: string }
  currentSession: { id: string; metadata?: { title?: string } } | null
}

function SessionDropdown({ sessions, currentProject, currentSession }: SessionDropdownProps) {
  const [, navigate] = useLocation()
  const loadSession = useSessionStore(state => state.loadSession)
  const createSession = useSessionStore(state => state.createSession)
  const pendingSessionCreate = useSessionStore(state => state.pendingSessionCreate)
  const resetPendingSessionCreate = useSessionStore(state => state.resetPendingSessionCreate)

  // Navigate to new session when server confirms creation.
  // pendingSessionCreate transitions: false → true (waiting) → sessionId (ready to navigate) → false (done)
  useEffect(() => {
    if (typeof pendingSessionCreate === 'string' && currentProject) {
      navigate(`/p/${currentProject.id}/s/${pendingSessionCreate}`)
      resetPendingSessionCreate()
    }
  }, [pendingSessionCreate, currentProject, navigate, resetPendingSessionCreate])

  // Filter sessions to those belonging to the current project by ID
  const projectSessions = sessions.filter(session => session.projectId === currentProject.id).slice(0, 15)

  const groupedSessions = groupSessionsByDate(projectSessions)

  const items: DropdownMenuItem[] = []

  // Add "New session" as the first item
  items.push({
    label: (
      <div className="flex items-center gap-2 px-3 py-2 min-w-[160px]" data-testid="session-dropdown-new-session">
        <svg className="w-4 h-4 text-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span className="text-sm">New session</span>
      </div>
    ),
    onClick: () => {
      createSession(currentProject.id)
    },
  })

  for (const [_dateKey, daySessions] of groupedSessions) {
    const firstSession = daySessions[0]
    if (!firstSession) continue

    items.push({
      label: (
        <div className="px-3 py-2 text-text-muted text-xs font-medium cursor-default">
          {formatDateHeader(firstSession.updatedAt)}
        </div>
      ),
      onClick: () => {},
    })

    for (const session of daySessions) {
      items.push({
        label: (
          <div className="min-w-[160px]">
            <div className="truncate text-sm">{session.title ?? session.id.slice(0, 8)}</div>
            <div className="text-text-muted text-xs">{formatTime(session.updatedAt)}</div>
          </div>
        ),
        icon: session.id === currentSession?.id ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : undefined,
        href: `/p/${currentProject.id}/s/${session.id}`,
        onClick: () => {
          loadSession(session.id)
        },
      })
    }
  }

  const triggerLabel = currentSession
    ? (currentSession.metadata?.title ?? currentSession.id.slice(0, 8))
    : 'No session selected'

  return (
    <DropdownMenu
      items={items}
      trigger={
        <button
          className="text-text-secondary hover:text-text-primary hover:underline text-sm truncate flex items-center gap-1"
          title={triggerLabel}
          data-testid="header-session-dropdown"
        >
          {triggerLabel}
          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      }
      minWidth="280px"
    />
  )
}

export function Header({ onMenuClick, onCriteriaToggle, hasCriteria }: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false)
  const connectionStatus = useSessionStore(state => state.connectionStatus)
  const session = useSessionStore(state => state.currentSession)
  const sessions = useSessionStore(state => state.sessions)
  const project = useProjectStore(state => state.currentProject)
  const projects = useProjectStore(state => state.projects)
  const startAutoRefresh = useConfigStore(state => state.startAutoRefresh)
  const stopAutoRefresh = useConfigStore(state => state.stopAutoRefresh)
  const toggleTerminal = useTerminalStore(state => state.toggleOpen)
  const terminalIsOpen = useTerminalStore(state => state.isOpen)

  // Start auto-refresh on mount
  useEffect(() => {
    startAutoRefresh()
    return () => stopAutoRefresh()
  }, [startAutoRefresh, stopAutoRefresh])

  return (
    <header className="h-8 bg-bg-secondary border-b border-border flex items-center justify-between px-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* Hamburger menu button - visible on mobile and tablet */}
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="xl:hidden flex-shrink-0 p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Toggle sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}

        <Link href="/" className="text-accent-primary font-semibold text-base hover:underline flex-shrink-0">
          OpenFox
        </Link>
        {project && (
          <>
            <span className="text-text-muted flex-shrink-0">/</span>
            <ProjectDropdown
              projects={projects}
              currentProject={project}
            />
          </>
        )}
        {project && (
          <>
            <span className="text-text-muted flex-shrink-0">/</span>
            <SessionDropdown
              sessions={sessions}
              currentProject={project}
              currentSession={session}
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Criteria toggle button - only visible when there are criteria */}
        {onCriteriaToggle && hasCriteria && (
          <button
            onClick={onCriteriaToggle}
            className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Toggle criteria sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </button>
        )}

        {/* Terminal toggle button */}
        <button
          onClick={toggleTerminal}
          className={`p-2.5 rounded hover:bg-bg-tertiary transition-colors ${
            terminalIsOpen ? 'text-accent-primary' : 'text-text-muted hover:text-text-primary'
          }`}
          title="Toggle terminal"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3 1h10v1H5V6zm10 7H5v1h10v-1zm-10 2H5v1h10v-1z" clipRule="evenodd" />
          </svg>
        </button>

        {/* Settings button */}
        <button
          onClick={() => setShowSettings(true)}
          className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
          title="Settings"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {/* Connection status - icon-only on mobile, full on desktop */}
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            connectionStatus === 'connected' ? 'bg-accent-success' :
            connectionStatus === 'reconnecting' ? 'bg-accent-warning animate-pulse' :
            'bg-accent-error'
          }`} />
          <span className="text-sm text-text-secondary hidden sm:inline">
            {connectionStatus === 'connected' ? 'Connected' :
             connectionStatus === 'reconnecting' ? 'Reconnecting...' :
             'Disconnected'}
          </span>
        </div>
      </div>

      {/* Settings Modal */}
      <GlobalSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* Terminal Modal */}
      <TerminalModal isOpen={terminalIsOpen} onClose={() => toggleTerminal()} />

    </header>
  )
}
