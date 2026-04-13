import { useState, useEffect, useCallback, useRef } from 'react'
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

interface MobileNavProps {
  currentProject: { id: string; name: string; workdir: string } | null
  sessions: SessionSummary[]
  currentSession: { id: string; metadata?: { title?: string } } | null
  projectIdFromUrl: string | null
}

function MobileNav({ currentProject, sessions, currentSession, projectIdFromUrl }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  if (!currentProject?.id || currentProject.id !== projectIdFromUrl) {
    return null
  }

  const projectSessions = sessions
    .filter(s => s.projectId === currentProject.id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5)

  const items: DropdownMenuItem[] = []

  items.push({
    label: (
      <Link href={`/p/${currentProject.id}/new`} className="flex items-center gap-2">
        <svg className="w-3 h-3 text-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span className="text-sm">New Session</span>
      </Link>
    ),
    onClick: () => {},
  })

  for (const session of projectSessions) {
    items.push({
      label: (
        <Link href={`/p/${currentProject.id}/s/${session.id}`} className="flex items-center gap-2 truncate text-sm">
          <span>{session.title ?? session.id.slice(0, 8)}</span>
        </Link>
      ),
      icon: session.id === currentSession?.id ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : undefined,
      onClick: () => {},
    })
  }

  items.push({
    label: (
      <Link href="/" className="flex items-center gap-2 text-text-muted hover:text-text-primary">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span className="text-sm">Projects</span>
      </Link>
    ),
    onClick: () => {},
  })

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors"
      >
        <span className="text-sm text-text-secondary font-medium">
          {currentProject?.name}
        </span>
        <svg
          className="w-3 h-3 text-text-muted flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && items.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-bg-secondary border border-border rounded-lg shadow-lg overflow-hidden z-50">
          {items.map((item, index) => {
            if (item.label && typeof item.label === 'object' && (item.label as React.ReactElement).type === Link) {
              const linkEl = item.label as React.ReactElement<{ href?: string; children?: React.ReactNode }>
              const href = linkEl.props.href || ''
              return (
                <Link
                  key={index}
                  href={href}
                  className="flex items-center gap-2 px-3 py-2 text-sm border-b border-border hover:bg-bg-tertiary transition-colors"
                >
                  {item.icon}
                  {linkEl.props.children}
                </Link>
              )
            }
            if (item.href) {
              return (
                <a
                  key={index}
                  href={item.href}
                  className="flex items-center gap-2 px-3 py-2 text-sm border-b border-border hover:bg-bg-tertiary transition-colors"
                >
                  {item.icon}
                  {item.label}
                </a>
              )
            }
            return (
              <button
                key={index}
                type="button"
                onClick={() => {
                  item.onClick?.()
                  setIsOpen(false)
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left border-b border-border hover:bg-bg-tertiary transition-colors"
              >
                {item.icon}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface SessionDropdownProps {
  sessions: SessionSummary[]
  currentProject: { id: string; name: string; workdir: string }
  currentSession: { id: string; metadata?: { title?: string } } | null
}

function SessionDropdown({ sessions, currentProject, currentSession }: SessionDropdownProps) {
  const loadSession = useSessionStore(state => state.loadSession)

  // Filter sessions to those belonging to the current project by ID
  const projectSessions = sessions.filter(session => session.projectId === currentProject.id).slice(0, 15)

  const groupedSessions = groupSessionsByDate(projectSessions)

  const items: DropdownMenuItem[] = []

  // Add "New session" as the first item
  items.push({
    label: (
      <Link href={`/p/${currentProject.id}/new`} className="flex items-center gap-2 px-3 py-2 min-w-[160px]" data-testid="session-dropdown-new-session">
        <svg className="w-4 h-4 text-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span className="text-sm">New session</span>
      </Link>
    ),
    onClick: () => {},
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

export function Header({ onMenuClick, onCriteriaToggle }: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false)
  const [location] = useLocation()
  const isProjectPage = location.startsWith('/p/')
  const isSessionPage = /^\/p\/[^/]+\/s\/[^/]+$/.test(location)
  const session = useSessionStore(state => state.currentSession)
  const sessions = useSessionStore(state => state.sessions)
  const project = useProjectStore(state => state.currentProject)
  const projects = useProjectStore(state => state.projects)
  const startAutoRefresh = useConfigStore(state => state.startAutoRefresh)
  const stopAutoRefresh = useConfigStore(state => state.stopAutoRefresh)
  const setTerminalOpen = useTerminalStore(state => state.setOpen)
  const terminalIsOpen = useTerminalStore(state => state.isOpen)

  const focusChatTextarea = useCallback(() => {
    const textarea = document.querySelector('textarea[placeholder*="What would you like to build"], textarea[placeholder*="Send a message"]') as HTMLTextAreaElement | null
    if (textarea) {
      textarea.focus()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '²' || e.key === '`') {
        e.preventDefault()
        if (!terminalIsOpen) {
          setTerminalOpen(true)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [terminalIsOpen, setTerminalOpen])

  // Start auto-refresh on mount
  useEffect(() => {
    startAutoRefresh()
    return () => stopAutoRefresh()
  }, [startAutoRefresh, stopAutoRefresh])

  return (
    <header className="h-8 bg-bg-secondary border-b border-border flex items-center justify-between px-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* Left sidebar toggle - only on project pages */}
        {onMenuClick && isProjectPage && (
          <button
            onClick={onMenuClick}
            className="flex-shrink-0 p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Toggle session list"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}

        {/* Desktop: OpenFox logo */}
        <Link href="/" className="text-accent-primary font-semibold text-base hover:underline flex-shrink-0 hidden md:inline">
          OpenFox
        </Link>
        {project && (
          <>
            {/* Desktop: separate project and session dropdowns */}
            <span className="hidden md:inline text-text-muted flex-shrink-0">/</span>
            <span className="hidden md:inline">
              <ProjectDropdown
                projects={projects}
                currentProject={project}
              />
            </span>

            {/* Mobile: compact combined dropdown - replaces OpenFox link */}
            <span className="md:hidden">
              <MobileNav
                key={project?.id}
                currentProject={project}
                sessions={sessions}
                currentSession={session}
                projectIdFromUrl={isProjectPage ? (location.split('/')[2] || null) : null}
              />
            </span>
            <span className="hidden md:inline text-text-muted flex-shrink-0">/</span>
            <span className="hidden md:inline">
              <SessionDropdown
                sessions={sessions}
                currentProject={project}
                currentSession={session}
              />
            </span>

            
          </>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Terminal toggle button - only visible on project pages */}
        {isProjectPage && (
          <button
            onClick={() => setTerminalOpen(!terminalIsOpen)}
            className={`p-2.5 rounded hover:bg-bg-tertiary transition-colors ${
              terminalIsOpen ? 'text-accent-primary' : 'text-text-muted hover:text-text-primary'
            }`}
            title="Toggle terminal (²)"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3 1h10v1H5V6zm10 7H5v1h10v-1zm-10 2H5v1h10v-1z" clipRule="evenodd" />
            </svg>
          </button>
        )}

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

        {/* Logout button - always visible */}
        <button
          onClick={() => {
            localStorage.removeItem('openfox_token')
            window.location.reload()
          }}
          className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
          title="Logout"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>

        {/* Right sidebar toggle - only on session pages, far right */}
        {onCriteriaToggle && isSessionPage && (
          <button
            onClick={onCriteriaToggle}
            className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Toggle summary sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
      </div>

      {/* Settings Modal */}
      <GlobalSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* Terminal Modal */}
      <TerminalModal 
        isOpen={terminalIsOpen} 
        onClose={() => setTerminalOpen(false)} 
        onFocusChat={focusChatTextarea}
      />

    </header>
  )
}
