import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react'
import {
  MenuIcon,
  PlusIcon,
  CheckIcon,
  ChevronDownIcon,
  SettingsIcon,
  LogoutIcon,
  TerminalIcon,
  ArchiveIcon,
  FullscreenIcon,
  FullscreenExitIcon,
} from '../shared/icons'
import { Link, useLocation } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { useProjectStore } from '../../stores/project'
import { useConfigStore } from '../../stores/config'
import { useTerminalStore } from '../../stores/terminal'
import { GlobalSettingsModal } from '../settings/GlobalSettingsModal'
import { TerminalDrawer } from '../terminal/TerminalDrawer'
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

interface InlineDropdownItem {
  label: ReactNode
  icon?: ReactNode
  href?: string
  onClick?: () => void
}

interface InlineDropdownProps {
  items: InlineDropdownItem[]
  trigger: ReactNode
  isActive?: boolean
}

function InlineDropdown({ items, trigger, isActive = false }: InlineDropdownProps) {
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

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${isActive ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'}`}
      >
        {typeof trigger === 'string' ? (
          <span className="text-sm text-text-secondary font-medium">{trigger}</span>
        ) : trigger}
        <ChevronDownIcon className="w-3 h-3 text-text-muted flex-shrink-0 transition-transform" rotate={isOpen ? 180 : 0} />
      </button>

      {isOpen && items.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-bg-secondary border border-border rounded-lg shadow-lg overflow-hidden z-50">
          {items.map((item, index) => {
            const linkChild = item.label && typeof item.label === 'object' && (item.label as React.ReactElement).type === Link
              ? (item.label as React.ReactElement<{ href?: string; children?: ReactNode }>)
              : null

            if (linkChild) {
              const href = linkChild.props.href || ''
              return (
                <Link
                  key={index}
                  href={href}
                  className="flex items-center gap-2 px-3 py-2 text-sm border-b border-border hover:bg-bg-tertiary transition-colors"
                >
                  {item.icon}
                  {linkChild.props.children}
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

function ProjectDropdown({ projects, currentProject }: ProjectDropdownProps) {
  const loadProject = useProjectStore(state => state.loadProject)

  const sortedProjects = [...projects].sort((a, b) => a.name.localeCompare(b.name))

  const items: DropdownMenuItem[] = sortedProjects.map(proj => ({
    label: proj.name,
    icon: proj.id === currentProject.id ? <CheckIcon /> : undefined,
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
          <ChevronDownIcon />
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
  if (!currentProject?.id || currentProject.id !== projectIdFromUrl) {
    return null
  }

  const projectSessions = sessions
    .filter(s => s.projectId === currentProject.id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5)

  const items: InlineDropdownItem[] = [
    {
      label: (
        <Link href={`/p/${currentProject.id}/new`} className="flex items-center gap-2">
          <PlusIcon className="w-3 h-3 text-accent-primary" />
          <span className="text-sm">New Session</span>
        </Link>
      ),
    },
    ...projectSessions.map(session => ({
      label: (
        <Link href={`/p/${currentProject.id}/s/${session.id}`} className="flex items-center gap-2 truncate text-sm">
          <span>{session.title ?? session.id.slice(0, 8)}</span>
        </Link>
      ),
      icon: session.id === currentSession?.id ? <CheckIcon className="w-3 h-3" /> : undefined,
    })),
    {
      label: (
        <Link href="/" className="flex items-center gap-2 text-text-muted hover:text-text-primary">
          <ArchiveIcon className="w-3 h-3" />
          <span className="text-sm">Projects</span>
        </Link>
      ),
    },
  ]

  return (
    <InlineDropdown
      items={items}
      trigger={<span className="text-sm text-text-secondary font-medium">{currentProject.name}</span>}
    />
  )
}

interface SessionDropdownProps {
  sessions: SessionSummary[]
  currentProject: { id: string; name: string; workdir: string }
  currentSession: { id: string; metadata?: { title?: string } } | null
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

function SessionDropdown({ sessions, currentProject, currentSession, isOpen, onOpenChange }: SessionDropdownProps) {
  const loadSession = useSessionStore(state => state.loadSession)

  const projectSessions = sessions.filter(session => session.projectId === currentProject.id).slice(0, 15)
  const groupedSessions = groupSessionsByDate(projectSessions)

  const items: DropdownMenuItem[] = useMemo(() => {
    const result: DropdownMenuItem[] = []

    result.push({
      label: (
        <div className="flex items-center gap-2">
          <PlusIcon className="w-4 h-4 text-accent-primary" />
          <span className="text-sm">New session</span>
        </div>
      ),
      href: `/p/${currentProject.id}/new`,
      onClick: () => {},
    })

    for (const [_dateKey, daySessions] of groupedSessions) {
      const firstSession = daySessions[0]
      if (!firstSession) continue

      result.push({
        label: (
          <div className="px-3 py-2 text-text-muted text-xs font-medium cursor-default">
            {formatDateHeader(firstSession.updatedAt)}
          </div>
        ),
        onClick: () => {},
      })

      for (const session of daySessions) {
        result.push({
          label: (
            <div className="min-w-[160px]">
              <div className="truncate text-sm">{session.title ?? session.id.slice(0, 8)}</div>
              <div className="text-text-muted text-xs">{formatTime(session.updatedAt)}</div>
            </div>
          ),
          icon: session.id === currentSession?.id ? <CheckIcon /> : undefined,
          href: `/p/${currentProject.id}/s/${session.id}`,
          onClick: () => {
            loadSession(session.id)
          },
        })
      }
    }

    return result
  }, [currentProject.id, groupedSessions, currentSession?.id])

  const triggerLabel = currentSession
    ? (currentSession.metadata?.title ?? currentSession.id.slice(0, 8))
    : 'No session selected'

  return (
    <DropdownMenu
      items={items}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      trigger={
        <button
          className="text-text-secondary hover:text-text-primary hover:underline text-sm truncate flex items-center gap-1"
          title={triggerLabel}
          data-testid="header-session-dropdown"
        >
          {triggerLabel}
          <ChevronDownIcon />
        </button>
      }
      minWidth="280px"
    />
  )
}

export function Header({ onMenuClick, onCriteriaToggle }: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false)
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
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

  useEffect(() => {
    const handler = () => setSessionDropdownOpen(true)
    window.addEventListener('open-session-dropdown', handler)
    return () => window.removeEventListener('open-session-dropdown', handler)
  }, [])

  

  // Ctrl+J opens terminal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'j' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        e.stopPropagation()
        useTerminalStore.getState().toggleOpen()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // Start auto-refresh on mount
  useEffect(() => {
    startAutoRefresh()
    return () => stopAutoRefresh()
  }, [startAutoRefresh, stopAutoRefresh])

  return (
    <header className="h-8 bg-secondary border-b border-border flex items-center justify-between px-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* Left sidebar toggle - only on project pages */}
        {onMenuClick && isProjectPage && (
          <button
            onClick={onMenuClick}
            className="flex-shrink-0 p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Toggle session list"
          >
            <MenuIcon />
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
                isOpen={sessionDropdownOpen}
                onOpenChange={setSessionDropdownOpen}
              />
            </span>

            
          </>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Fullscreen toggle - mobile only (< 512px) */}
        {isSessionPage && (
          <button
            onClick={() => {
              if (document.fullscreenElement) {
                document.exitFullscreen?.()
              } else {
                document.documentElement.requestFullscreen?.()
              }
            }}
            className="max-sm:block hidden p-2 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </button>
        )}

        {/* Terminal toggle button - only visible on project pages */}
        {/* Terminal toggle button - only visible on project pages */}
        {isProjectPage && (
          <button
            onClick={() => setTerminalOpen(!terminalIsOpen)}
            className={`p-2.5 rounded hover:bg-bg-tertiary transition-colors ${
              terminalIsOpen ? 'text-accent-primary' : 'text-text-muted hover:text-text-primary'
            }`}
            title="Toggle terminal (double Ctrl)"
          >
            <TerminalIcon />
          </button>
        )}

        {/* Settings button */}
        <button
          onClick={() => setShowSettings(true)}
          className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
          title="Settings"
        >
          <SettingsIcon />
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
          <LogoutIcon />
        </button>

        {/* Right sidebar toggle - only on session pages, far right */}
        {onCriteriaToggle && isSessionPage && (
          <button
            onClick={onCriteriaToggle}
            className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Toggle summary sidebar"
          >
            <MenuIcon />
          </button>
        )}
      </div>

      {/* Settings Modal */}
      <GlobalSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* Terminal Drawer */}
      <TerminalDrawer 
        isOpen={terminalIsOpen} 
        onClose={() => setTerminalOpen(false)} 
      />

    </header>
  )
}
