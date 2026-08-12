import { useState, useEffect } from 'react'
import {
  MenuIcon,
  SettingsIcon,
  LogoutIcon,
  TerminalIcon,
  FullscreenIcon,
  FullscreenExitIcon,
  FolderIcon,
  ColumnsIcon,
  XCloseIcon,
} from '../shared/icons'
import { Link, useLocation } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { useProjectStore } from '../../stores/project'
import { useConfigStore } from '../../stores/config'
import { useTerminalStore } from '../../stores/terminal'
import { useUpdateStore } from '../../stores/update'
import { useKeybindings, useBinding } from '../../hooks/useKeybindings'
import { formatKeybinding } from '../../lib/keybindings'
import { authFetch } from '../../lib/api'
import { GlobalSettingsModal } from '../settings/GlobalSettingsModal'
import { TerminalDrawer } from '../terminal/TerminalDrawer'
import { ProjectDropdown } from './ProjectDropdown'
import { SessionDropdown } from './SessionDropdown'
import { MobileNav } from './MobileNav'
import { TasksModal } from '../tasks/TasksModal'
import { useTasksStore } from '../../stores/tasks'
import { TasksIcon, ArrowRightIcon } from '../shared/icons'
import { useIsSplit } from '../../lib/splitPersistence'

interface HeaderProps {
  onMenuClick?: () => void
  onCriteriaToggle?: () => void
}

export function Header({ onMenuClick, onCriteriaToggle }: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false)
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)
  const [location, setLocation] = useLocation()
  const [tasksModalOpen, setTasksModalOpen] = useState(false)
  const runningTaskCount = useTasksStore((state) => state.counts.running)
  const loadCounts = useTasksStore((state) => state.loadCounts)
  const activeProjectId = useTasksStore((state) => state.activeProjectId)
  const lastAutoLaunch = useTasksStore((state) => state.lastAutoLaunch)
  const clearAutoLaunch = useTasksStore((state) => state.clearAutoLaunch)

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const isProjectPage = location.startsWith('/p/')
  const isSessionPage = /^\/p\/[^/]+\/s\/[^/]+$/.test(location)
  const isSplit = useIsSplit()
  const openSessionCount = useSessionStore((state) => state.openSessionIds.length)
  const session = useSessionStore((state) => state.currentSession)
  const sessions = useSessionStore((state) => state.sessions)
  const project = useProjectStore((state) => state.currentProject)
  const projects = useProjectStore((state) => state.projects)
  const startAutoRefresh = useConfigStore((state) => state.startAutoRefresh)
  const stopAutoRefresh = useConfigStore((state) => state.stopAutoRefresh)
  const setTerminalOpen = useTerminalStore((state) => state.setOpen)
  const terminalIsOpen = useTerminalStore((state) => state.isOpen)
  const updateAvailable = useUpdateStore((state) => state.status === 'available')
  const checkForUpdate = useUpdateStore((state) => state.check)

  useEffect(() => {
    if (useUpdateStore.getState().status === 'idle') {
      checkForUpdate()
    }
  }, [checkForUpdate])

  useEffect(() => {
    const handler = () => setSessionDropdownOpen(true)
    window.addEventListener('open-session-dropdown', handler)
    return () => window.removeEventListener('open-session-dropdown', handler)
  }, [])

  const keybindings = useKeybindings()
  useBinding(
    keybindings.terminalToggle,
    () => {
      useTerminalStore.getState().toggleOpen()
    },
    { capture: true },
  )

  useEffect(() => {
    if (project?.id && activeProjectId !== project.id) {
      void loadCounts(project.id)
    }
  }, [project?.id, activeProjectId, loadCounts])

  useEffect(() => {
    startAutoRefresh()
    return () => stopAutoRefresh()
  }, [startAutoRefresh, stopAutoRefresh])

  return (
    <header className="h-8 bg-secondary border-b border-border flex items-center justify-between px-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {(onMenuClick && isSessionPage) || (onMenuClick && isSplit) ? (
          <button
            onClick={onMenuClick}
            className="flex-shrink-0 p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title={isSplit ? 'Toggle split view control panel' : 'Toggle session list'}
            aria-label={isSplit ? 'Toggle split view control panel' : 'Toggle session list'}
          >
            <MenuIcon />
          </button>
        ) : null}

        <Link
          href="/"
          className="text-accent-primary font-semibold text-sm hover:underline flex-shrink-0 hidden md:inline"
        >
          OpenFox
        </Link>

        {!isSplit && project && (
          <>
            <span className="hidden md:inline text-text-muted flex-shrink-0">/</span>
            <span className="hidden md:inline">
              <ProjectDropdown projects={projects} currentProject={project} />
            </span>

            <span className="md:hidden">
              <MobileNav
                key={project?.id}
                currentProject={project}
                sessions={sessions}
                currentSession={session}
                projectIdFromUrl={isProjectPage ? location.split('/')[2] || null : null}
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

        {!isSplit && !project && (
          <span className="hidden md:inline">
            <ProjectDropdown projects={projects} />
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {!isSplit && (
          <button
            onClick={() => {
              const sid = session?.id
              if (isSessionPage && sid) {
                void useSessionStore.getState().openPane(sid, { focus: true })
              }
              setLocation('/split-view')
            }}
            className="p-2.5 rounded hover:bg-bg-tertiary transition-colors text-text-muted hover:text-text-primary"
            title="Open split view"
            aria-label="Open split view"
          >
            <ColumnsIcon className="w-4 h-4" />
          </button>
        )}

        {isSplit && (
          <>
            <span
              className="flex items-center gap-1 text-xs text-text-muted px-1.5"
              title="Split view active"
              data-testid="split-indicator"
            >
              <ColumnsIcon className="w-3.5 h-3.5" />
              {openSessionCount}
            </span>
            <button
              onClick={() => {
                useSessionStore.getState().exitSplitView()
                setLocation('/')
              }}
              className="p-2.5 rounded hover:bg-bg-tertiary transition-colors text-text-muted hover:text-text-primary"
              title="Exit split view"
              aria-label="Exit split view"
            >
              <XCloseIcon className="w-4 h-4" />
            </button>
          </>
        )}

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

        {isProjectPage && (
          <button
            onClick={() => setTasksModalOpen(true)}
            className="relative p-2.5 rounded hover:bg-bg-tertiary transition-colors text-text-muted hover:text-text-primary"
            title="Project tasks"
            aria-label="Open project tasks"
          >
            <TasksIcon className="w-4 h-4" />
            {runningTaskCount > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-accent-success text-white text-[9px] font-semibold flex items-center justify-center">
                {runningTaskCount > 99 ? '99+' : runningTaskCount}
              </span>
            )}
          </button>
        )}

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

        {isProjectPage && project && (
          <button
            onClick={() => authFetch(`/api/projects/${project.id}/open-folder`).catch(() => {})}
            className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Open project folder"
          >
            <FolderIcon className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={() => setShowSettings(true)}
          className="relative p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
          title={updateAvailable ? 'Settings — update available' : 'Settings'}
        >
          <SettingsIcon />
          {updateAvailable && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent-primary" />}
        </button>

        <button
          onClick={() => {
            localStorage.removeItem('openfox_token')
            setLocation('/')
          }}
          className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
          title="Logout"
        >
          <LogoutIcon />
        </button>

        {onCriteriaToggle && isSessionPage && (
          <button
            onClick={onCriteriaToggle}
            className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title={
              keybindings.criteriaSidebar
                ? `Toggle criteria sidebar (${formatKeybinding(keybindings.criteriaSidebar)})`
                : 'Toggle criteria sidebar'
            }
          >
            <MenuIcon />
          </button>
        )}
      </div>

      <GlobalSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <TerminalDrawer isOpen={terminalIsOpen} onClose={() => setTerminalOpen(false)} />
      {project && (
        <TasksModal isOpen={tasksModalOpen} onClose={() => setTasksModalOpen(false)} projectId={project.id} />
      )}
      {lastAutoLaunch && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg bg-bg-secondary border border-border shadow-xl text-sm text-text-primary">
          <span>“{lastAutoLaunch.taskTitle}” auto-launched — a slot freed up.</span>
          <button
            type="button"
            onClick={() => {
              const sessionId = lastAutoLaunch.sessionId
              const targetProjectId = lastAutoLaunch.projectId
              clearAutoLaunch()
              setLocation(`/p/${targetProjectId}/s/${sessionId}`)
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent-primary/25 hover:bg-accent-primary/40 font-medium transition-colors"
          >
            Open session <ArrowRightIcon className="w-3 h-3" />
          </button>
          <button type="button" onClick={clearAutoLaunch} className="text-xs text-text-muted underline">
            Dismiss
          </button>
        </div>
      )}
    </header>
  )
}
