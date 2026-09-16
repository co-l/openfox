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
  ChevronDownIcon,
} from '../shared/icons'
import { Link, useLocation } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { useCurrentProject } from '../../hooks/useCurrentProject'
import { useProjects } from '../../hooks/useProjects'
import { useResource } from '../../hooks/useResource'
import { useT } from '../../hooks/useT'
import { summariesResource } from '../../lib/resources'
import { useConfigStore } from '../../stores/config'
import { useTerminalStore } from '../../stores/terminal'
import { useUpdateStore } from '../../stores/update'
import { useKeybindings, useBinding } from '../../hooks/useKeybindings'
import { formatKeybinding } from '../../lib/keybindings'
import { authFetch, hasStoredToken } from '../../lib/api'
import { GlobalSettingsModal } from '../settings/GlobalSettingsModal'
import { TerminalDrawer } from '../terminal/TerminalDrawer'
import { ProjectDropdown } from './ProjectDropdown'
import { SessionDropdown } from './SessionDropdown'
import { TasksModal } from '../tasks/TasksModal'
import { QuotaModal } from '../QuotaModal'
import { useTasksStore } from '../../stores/tasks'
import { TasksIcon, ArrowRightIcon, QuotaIcon } from '../shared/icons'
import { useIsSplit } from '../../lib/splitPersistence'
import { DropdownMenu, type DropdownMenuItem } from '../shared/DropdownMenu'
import { useQuota } from '../../hooks/useQuota'

interface HeaderProps {
  onMenuClick?: () => void
  onCriteriaToggle?: () => void
}

export function Header({ onMenuClick, onCriteriaToggle }: HeaderProps) {
  const t = useT()
  const [showSettings, setShowSettings] = useState(false)
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)
  const [location, setLocation] = useLocation()
  const [tasksModalOpen, setTasksModalOpen] = useState(false)
  const [quotaModalOpen, setQuotaModalOpen] = useState(false)
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
  const project = useCurrentProject()
  const { projects } = useProjects()
  const { data: countsData } = useResource(summariesResource, project?.id ?? '')
  const runningTaskCount = countsData?.counts.running ?? 0
  const startAutoRefresh = useConfigStore((state) => state.startAutoRefresh)
  const stopAutoRefresh = useConfigStore((state) => state.stopAutoRefresh)
  const setTerminalOpen = useTerminalStore((state) => state.setOpen)
  const terminalIsOpen = useTerminalStore((state) => state.isOpen)
  const updateAvailable = useUpdateStore((state) => state.status === 'available')
  const checkForUpdate = useUpdateStore((state) => state.check)
  const { hasWarning: quotaWarning, refresh: refreshQuota } = useQuota()

  useEffect(() => {
    if (useUpdateStore.getState().status === 'idle') {
      checkForUpdate()
    }
  }, [checkForUpdate])

  useEffect(() => {
    // Refetch on window focus so the warning dot clears after quota recovers.
    const onFocus = () => void refreshQuota()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshQuota])

  useEffect(() => {
    const handler = () => setSessionDropdownOpen(true)
    window.addEventListener('open-session-dropdown', handler)
    return () => window.removeEventListener('open-session-dropdown', handler)
  }, [])

  const connectionStatus = useSessionStore((state) => state.connectionStatus)
  const keybindings = useKeybindings(connectionStatus === 'connected' || hasStoredToken())
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

  const mobileMenuItems: DropdownMenuItem[] = []
  if (isProjectPage) {
    mobileMenuItems.push({
      label: (
        <span className="flex items-center gap-2">
          {t({ en: 'Tasks', fr: 'Tâches' })}
          {runningTaskCount > 0 && (
            <span className="min-w-3.5 h-3.5 px-0.5 rounded-full bg-accent-success text-white text-[9px] font-semibold flex items-center justify-center">
              {runningTaskCount > 99 ? '99+' : runningTaskCount}
            </span>
          )}
        </span>
      ),
      icon: <TasksIcon className="w-4 h-4" />,
      onClick: () => setTasksModalOpen(true),
    })
    mobileMenuItems.push({
      label: t({ en: 'Terminal', fr: 'Terminal' }),
      icon: <TerminalIcon className={`w-4 h-4 ${terminalIsOpen ? 'text-accent-primary' : ''}`} />,
      onClick: () => setTerminalOpen(!terminalIsOpen),
    })
    if (project) {
      mobileMenuItems.push({
        label: t({ en: 'Open Folder', fr: 'Ouvrir le dossier' }),
        icon: <FolderIcon className="w-4 h-4" />,
        onClick: () => authFetch(`/api/projects/${project.id}/open-folder`).catch(() => {}),
      })
    }
  }
  mobileMenuItems.push({
    label: (
      <span className="flex items-center gap-2">
        {t({ en: 'Usage & Quotas', fr: 'Utilisation & quotas' })}
        {quotaWarning && <span className="w-1.5 h-1.5 rounded-full bg-accent-danger" />}
      </span>
    ),
    icon: <QuotaIcon />,
    onClick: () => setQuotaModalOpen(true),
  })
  mobileMenuItems.push({
    label: (
      <span className="flex items-center gap-2">
        {t({ en: 'Settings', fr: 'Paramètres' })}
        {updateAvailable && <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" />}
      </span>
    ),
    icon: <SettingsIcon />,
    onClick: () => setShowSettings(true),
  })
  mobileMenuItems.push({
    label: isFullscreen
      ? t({ en: 'Exit Fullscreen', fr: 'Quitter le plein écran' })
      : t({ en: 'Enter Fullscreen', fr: 'Plein écran' }),
    icon: isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />,
    onClick: () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.()
      } else {
        document.documentElement.requestFullscreen?.()
      }
    },
  })
  mobileMenuItems.push({
    label: t({ en: 'Logout', fr: 'Se déconnecter' }),
    icon: <LogoutIcon />,
    danger: true,
    onClick: () => {
      void useSessionStore.getState().logout()
      setLocation('/')
    },
  })

  return (
    <header className="h-8 bg-secondary border-b border-border flex items-center justify-between px-2">
      <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
        {(onMenuClick && isSessionPage) || (onMenuClick && isSplit) ? (
          <button
            onClick={onMenuClick}
            className="flex-shrink-0 p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title={
              isSplit
                ? t({ en: 'Toggle split view control panel', fr: 'Basculer le panneau de contrôle de la vue divisée' })
                : t({ en: 'Toggle session list', fr: 'Basculer la liste des sessions' })
            }
            aria-label={
              isSplit
                ? t({ en: 'Toggle split view control panel', fr: 'Basculer le panneau de contrôle de la vue divisée' })
                : t({ en: 'Toggle session list', fr: 'Basculer la liste des sessions' })
            }
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
            <div className="flex-shrink-0">
              <ProjectDropdown projects={projects} currentProject={project} />
            </div>

            <span className="text-text-muted flex-shrink-0">/</span>
            <SessionDropdown
              sessions={sessions}
              currentProject={project}
              currentSession={session}
              isOpen={sessionDropdownOpen}
              onOpenChange={setSessionDropdownOpen}
            />
          </>
        )}

        {!isSplit && !project && <ProjectDropdown projects={projects} />}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="hidden md:flex items-center gap-2">
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
              title={t({ en: 'Open split view', fr: 'Ouvrir la vue divisée' })}
              aria-label={t({ en: 'Open split view', fr: 'Ouvrir la vue divisée' })}
            >
              <ColumnsIcon className="w-4 h-4" />
            </button>
          )}

          {isSplit && (
            <>
              <span
                className="flex items-center gap-1 text-xs text-text-muted px-1.5"
                title={t({ en: 'Split view active', fr: 'Vue divisée active' })}
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
                title={t({ en: 'Exit split view', fr: 'Quitter la vue divisée' })}
                aria-label={t({ en: 'Exit split view', fr: 'Quitter la vue divisée' })}
              >
                <XCloseIcon className="w-4 h-4" />
              </button>
            </>
          )}

          {isProjectPage && (
            <button
              onClick={() => setTasksModalOpen(true)}
              className="relative p-2.5 rounded hover:bg-bg-tertiary transition-colors text-text-muted hover:text-text-primary"
              title={t({ en: 'Project tasks', fr: 'Tâches du projet' })}
              aria-label={t({ en: 'Open project tasks', fr: 'Ouvrir les tâches du projet' })}
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
              title={t({ en: 'Toggle terminal (double Ctrl)', fr: 'Basculer le terminal (Ctrl double)' })}
            >
              <TerminalIcon />
            </button>
          )}

          {isProjectPage && project && (
            <button
              onClick={() => authFetch(`/api/projects/${project.id}/open-folder`).catch(() => {})}
              className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
              title={t({ en: 'Open project folder', fr: 'Ouvrir le dossier du projet' })}
            >
              <FolderIcon className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setQuotaModalOpen(true)}
            className="relative p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title={t({ en: 'Usage & quotas', fr: 'Utilisation & quotas' })}
            aria-label={t({ en: 'Open usage and quotas', fr: 'Ouvrir l’utilisation et les quotas' })}
          >
            <QuotaIcon />
            {quotaWarning && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent-danger" />}
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="relative p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title={
              updateAvailable
                ? t({ en: 'Settings — update available', fr: 'Paramètres — mise à jour disponible' })
                : t({ en: 'Settings', fr: 'Paramètres' })
            }
          >
            <SettingsIcon />
            {updateAvailable && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent-primary" />}
          </button>

          <button
            onClick={() => {
              void useSessionStore.getState().logout()
              setLocation('/')
            }}
            className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title={t({ en: 'Logout', fr: 'Se déconnecter' })}
          >
            <LogoutIcon />
          </button>
        </div>

        <div className="md:hidden">
          <DropdownMenu
            items={mobileMenuItems}
            align="right"
            minWidth="200px"
            trigger={
              <button
                className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
                title={t({ en: 'Menu', fr: 'Menu' })}
                aria-label={t({ en: 'Open header menu', fr: 'Ouvrir le menu d’en-tête' })}
              >
                <ChevronDownIcon className="w-4 h-4" />
              </button>
            }
          />
        </div>

        {onCriteriaToggle && isSessionPage && (
          <button
            onClick={onCriteriaToggle}
            className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title={
              keybindings.criteriaSidebar
                ? t(
                    { en: 'Toggle criteria sidebar ({{key}})', fr: 'Basculer la barre de critères ({{key}})' },
                    {
                      key: formatKeybinding(keybindings.criteriaSidebar),
                    },
                  )
                : t({ en: 'Toggle criteria sidebar', fr: 'Basculer la barre de critères' })
            }
          >
            <MenuIcon />
          </button>
        )}
      </div>

      <GlobalSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <QuotaModal isOpen={quotaModalOpen} onClose={() => setQuotaModalOpen(false)} />
      <TerminalDrawer isOpen={terminalIsOpen} onClose={() => setTerminalOpen(false)} />
      {project && (
        <TasksModal isOpen={tasksModalOpen} onClose={() => setTasksModalOpen(false)} projectId={project.id} />
      )}
      {lastAutoLaunch && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg bg-bg-secondary border border-border shadow-xl text-sm text-text-primary">
          <span>
            {t(
              {
                en: '“{{title}}” auto-launched — a slot freed up.',
                fr: '« {{title}} » lancé automatiquement — un emplacement s’est libéré.',
              },
              { title: lastAutoLaunch.taskTitle },
            )}
          </span>
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
            {t({ en: 'Open session', fr: 'Ouvrir la session' })} <ArrowRightIcon className="w-3 h-3" />
          </button>
          <button type="button" onClick={clearAutoLaunch} className="text-xs text-text-muted underline">
            {t({ en: 'Dismiss', fr: 'Fermer' })}
          </button>
        </div>
      )}
    </header>
  )
}
