import { useState, useEffect } from 'react'
import { MenuIcon, SettingsIcon, LogoutIcon, TerminalIcon, FullscreenIcon, FullscreenExitIcon } from '../shared/icons'
import { Link, useLocation } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { useProjectStore } from '../../stores/project'
import { useConfigStore } from '../../stores/config'
import { useTerminalStore } from '../../stores/terminal'
import { useUpdateStore } from '../../stores/update'
import { useKeybindings, useBinding } from '../../hooks/useKeybindings'
import { formatKeybinding } from '../../lib/keybindings'
import { GlobalSettingsModal } from '../settings/GlobalSettingsModal'
import { TerminalDrawer } from '../terminal/TerminalDrawer'
import { ProjectDropdown } from './ProjectDropdown'
import { SessionDropdown } from './SessionDropdown'
import { MobileNav } from './MobileNav'

interface HeaderProps {
  onMenuClick?: () => void
  onCriteriaToggle?: () => void
}

export function Header({ onMenuClick, onCriteriaToggle }: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false)
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)
  const [location, setLocation] = useLocation()

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const isProjectPage = location.startsWith('/p/')
  const isSessionPage = /^\/p\/[^/]+\/s\/[^/]+$/.test(location)
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
    startAutoRefresh()
    return () => stopAutoRefresh()
  }, [startAutoRefresh, stopAutoRefresh])

  return (
    <header className="h-8 bg-secondary border-b border-border flex items-center justify-between px-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {onMenuClick && isSessionPage && (
          <button
            onClick={onMenuClick}
            className="flex-shrink-0 p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title={
              keybindings.sessionSearch
                ? `Toggle session list (${formatKeybinding(keybindings.sessionSearch)})`
                : 'Toggle session list'
            }
          >
            <MenuIcon />
          </button>
        )}

        <Link
          href="/"
          className="text-accent-primary font-semibold text-sm hover:underline flex-shrink-0 hidden md:inline"
        >
          OpenFox
        </Link>

        {project && (
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

        {!project && (
          <span className="hidden md:inline">
            <ProjectDropdown projects={projects} />
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
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
            onClick={() => setTerminalOpen(!terminalIsOpen)}
            className={`p-2.5 rounded hover:bg-bg-tertiary transition-colors ${
              terminalIsOpen ? 'text-accent-primary' : 'text-text-muted hover:text-text-primary'
            }`}
            title="Toggle terminal (double Ctrl)"
          >
            <TerminalIcon />
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
    </header>
  )
}
