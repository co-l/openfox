import { ScrollArea } from './components/shared/ScrollArea'
import { useEffect, useRef, useState } from 'react'
import { SETTINGS_KEYS, DISPLAY_SETTINGS_KEYS, useSettingsStore } from './stores/settings'
import { useVisualViewport } from './hooks/useVisualViewport'
import { Route, Switch, useRoute, useLocation } from 'wouter'
import { useWebSocket } from './hooks/useWebSocket'
import { useSessionStore } from './stores/session'
import { useProjectStore } from './stores/project'
import { useConfigStore } from './stores/config'
import { useMcpStore } from './stores/mcp'
import { useThemeStore } from './stores/theme'
import { useProjectLoader } from './hooks/useProjectLoader'
import { useSessionLoader } from './hooks/useSessionLoader'

// Apply theme synchronously from localStorage before React renders
// to prevent flash of default theme
if (typeof window !== 'undefined') {
  useThemeStore.getState().loadUserPresets()
  useThemeStore.getState().applySavedTheme()
}

import { Header } from './components/layout/Header'
import { Sidebar } from './components/layout/Sidebar'
import { PageTitle } from './components/layout/PageTitle'
import { HomePage } from './components/HomePage'
import { NewSessionHandler } from './components/NewSessionHandler'
import { EmptyProjectView } from './components/EmptyProjectView'
import { PlanPanel } from './components/plan/PlanPanel'
import { ReadonlySessionView } from './components/plan/ReadonlySessionView'
import { SplitView } from './components/split/SplitView'
import { useIsSplit, readSplitLayout } from './lib/splitPersistence'
import { Spinner, SpinnerWithText } from './components/shared/Spinner'
import { PasswordModal } from './components/PasswordModal'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'
import { CrossSessionConfirmationBanner } from './components/shared/CrossSessionConfirmationBanner'
import { UpdateBanner } from './components/UpdateBanner'
import { ChangelogModal } from './components/ChangelogModal'
import { getStoredLastVersion, getStoredPreviousVersion, isVersionNewerThan, trackVersion } from './lib/versionTracking'

function hasStoredToken(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem('openfox_token') !== null
}

function LoadingSpinner() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Spinner />
    </div>
  )
}

function ProjectView({ sidebarOpen, onSidebarToggle }: { sidebarOpen: boolean; onSidebarToggle: () => void }) {
  const [, params] = useRoute('/p/:projectId')
  const projectId = params?.projectId

  const connectionStatus = useSessionStore((state) => state.connectionStatus)
  const currentProject = useProjectStore((state) => state.currentProject)

  const hasToken = hasStoredToken()
  const canLoad = connectionStatus === 'connected' || hasToken

  useProjectLoader({ canLoad, projectId, currentProjectId: currentProject?.id })

  if (!currentProject || currentProject.id !== projectId) {
    return <LoadingSpinner />
  }

  return (
    <>
      <Sidebar projectId={projectId!} isOpen={sidebarOpen} onClose={onSidebarToggle} />
      <div className="flex-1 min-w-0 bg-primary">
        <EmptyProjectView />
      </div>
    </>
  )
}

function ProjectSessionView({
  sidebarOpen,
  onSidebarToggle,
  rightSidebarOpen,
  onRightSidebarToggle,
}: {
  sidebarOpen: boolean
  onSidebarToggle: () => void
  rightSidebarOpen: boolean
  onRightSidebarToggle: () => void
}) {
  const [, params] = useRoute('/p/:projectId/s/:sessionId')
  const projectId = params?.projectId
  const sessionId = params?.sessionId
  const [, navigate] = useLocation()

  const connectionStatus = useSessionStore((state) => state.connectionStatus)
  const session = useSessionStore((state) => state.currentSession)
  const error = useSessionStore((state) => state.error)
  const clearError = useSessionStore((state) => state.clearError)
  const currentProject = useProjectStore((state) => state.currentProject)

  const hasToken = hasStoredToken()
  const canLoad = connectionStatus === 'connected' || hasToken

  useSessionLoader({
    canLoad,
    projectId,
    sessionId,
    currentProjectId: currentProject?.id,
    currentSessionId: session?.id,
  })

  useEffect(() => {
    if (error?.code === 'NOT_FOUND' && projectId) {
      clearError()
      navigate(`/p/${projectId}`)
    }
  }, [error, projectId, clearError, navigate])

  if (!currentProject || currentProject.id !== projectId) {
    return <LoadingSpinner />
  }

  return (
    <>
      <Sidebar projectId={projectId!} isOpen={sidebarOpen} onClose={onSidebarToggle} />
      <div className="flex-1 min-w-0 bg-primary flex flex-col">
        <CrossSessionConfirmationBanner projectId={projectId} />
        <PlanPanel criteriaSidebarOpen={rightSidebarOpen} onCriteriaSidebarToggle={onRightSidebarToggle} />
      </div>
    </>
  )
}

function OnboardingPage() {
  const fetchConfig = useConfigStore((state) => state.fetchConfig)
  const [, navigate] = useLocation()

  async function handleComplete() {
    await fetchConfig()
    navigate('/')
  }

  return (
    <ScrollArea className="flex-1">
      <OnboardingWizard onComplete={handleComplete} />
    </ScrollArea>
  )
}

function App() {
  const { connectionStatus } = useWebSocket()
  const fetchConfig = useConfigStore((state) => state.fetchConfig)
  const refreshProviderModels = useConfigStore((state) => state.refreshProviderModels)
  const providers = useConfigStore((state) => state.providers)
  const activeProviderId = useConfigStore((state) => state.activeProviderId)
  const [, navigate] = useLocation()

  const hasToken = hasStoredToken()

  const [configFetched, setConfigFetched] = useState(false)

  useEffect(() => {
    if (connectionStatus === 'connected' || hasToken) {
      fetchConfig().then(() => {
        setConfigFetched(true)
        // Batch load all display settings and keybindings in a single API call
        useSettingsStore
          .getState()
          .getSettings([
            ...DISPLAY_SETTINGS_KEYS,
            SETTINGS_KEYS.DISPLAY_THEME,
            SETTINGS_KEYS.DISPLAY_USER_PRESETS,
            SETTINGS_KEYS.DISPLAY_CUSTOM_CSS,
            SETTINGS_KEYS.KEYBINDINGS,
            SETTINGS_KEYS.FEATURES_PER_SESSION_MCP,
          ])
        // Eagerly load MCP servers for the chat MCP indicator
        useMcpStore.getState().fetchServers()
      })
    }
  }, [connectionStatus, hasToken, fetchConfig])

  useEffect(() => {
    if (configFetched && activeProviderId) {
      refreshProviderModels(activeProviderId).then(() => {
        // Only refresh config if we don't already have a valid defaultModelSelection
        // for this provider (avoids overwriting optimistic updates)
        const currentSelection = useConfigStore.getState().defaultModelSelection
        const selectionProvider = currentSelection ? currentSelection.split('/')[0] : null
        if (selectionProvider !== activeProviderId) {
          fetchConfig()
        }
      })
    }
  }, [configFetched, activeProviderId, refreshProviderModels, fetchConfig])

  const displaySettings = useSettingsStore((state) => state.settings)

  useEffect(() => {
    if (configFetched && providers.length === 0) {
      navigate('/onboarding')
    }
  }, [configFetched, providers.length])

  useEffect(() => {
    const { applyPreset, applyTokens, setFollowSystemTheme, initSystemThemeListener } = useThemeStore.getState()
    const serverTheme = displaySettings[SETTINGS_KEYS.DISPLAY_THEME]
    const serverPresets = displaySettings[SETTINGS_KEYS.DISPLAY_USER_PRESETS]
    const serverFollowSystem = displaySettings[SETTINGS_KEYS.DISPLAY_FOLLOW_SYSTEM_THEME]

    if (serverPresets) {
      localStorage.setItem('openfox:userPresets', serverPresets)
    }

    if (serverTheme) {
      localStorage.setItem('openfox:theme', serverTheme)
      try {
        const parsed = JSON.parse(serverTheme) as { preset?: string; tokens?: Record<string, string> }
        if (parsed.preset && parsed.tokens) {
          applyPreset(parsed.preset)
          useThemeStore.setState({ basePreset: parsed.preset })
          applyTokens(parsed.tokens)
        } else if (parsed.preset) {
          applyPreset(parsed.preset)
        } else if (parsed.tokens) {
          applyTokens(parsed.tokens)
        }
      } catch {
        applyPreset('dark')
      }
    } else {
      // Default to system theme if nothing saved
      applyPreset('system')
    }

    if (serverFollowSystem !== undefined) {
      const currentFollowSystem = useThemeStore.getState().followSystemTheme
      if (currentFollowSystem !== (serverFollowSystem === 'true')) {
        setFollowSystemTheme(serverFollowSystem === 'true')
      }
    }

    const cleanup = initSystemThemeListener()
    return () => cleanup()
  }, [displaySettings[SETTINGS_KEYS.DISPLAY_THEME], displaySettings[SETTINGS_KEYS.DISPLAY_USER_PRESETS]])

  // Inject custom CSS into a <style> tag
  useEffect(() => {
    const css = displaySettings[SETTINGS_KEYS.DISPLAY_CUSTOM_CSS] ?? ''
    let styleTag = document.getElementById('custom-css') as HTMLStyleElement | null
    if (!styleTag) {
      styleTag = document.createElement('style')
      styleTag.id = 'custom-css'
      document.head.appendChild(styleTag)
    }
    styleTag.textContent = css
  }, [displaySettings[SETTINGS_KEYS.DISPLAY_CUSTOM_CSS]])

  const [showChangelog, setShowChangelog] = useState(false)

  useEffect(() => {
    const setting = useSettingsStore.getState().settings[SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE]
    if (setting === undefined) return
    if (setting === 'false') return

    let shouldShow = false

    // Check update_pending flag (in-app auto-update)
    const pending = localStorage.getItem('update_pending')
    if (pending === 'true') {
      shouldShow = true
      localStorage.removeItem('update_pending')
    }

    // Check version change (npm / manual upgrade). Only a genuine upgrade
    // shows the modal (a downgrade or dev-prerelease drift has nothing new to
    // offer). trackVersion preserves the previous version durably, so the
    // changelog trim boundary survives even if a different window performed
    // or observed the update.
    if (configFetched) {
      const currentVersion = useConfigStore.getState().version
      const lastVersion = getStoredLastVersion()
      if (isVersionNewerThan(currentVersion, lastVersion)) {
        shouldShow = true
      }
      trackVersion(currentVersion)
    }

    if (shouldShow) {
      setShowChangelog(true)
    }
  }, [displaySettings[SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE], configFetched])

  const getInitialLeftSidebar = () => {
    const saved = localStorage.getItem('openfox:leftSidebar')
    return saved !== null ? saved === 'true' : true
  }

  const getInitialRightSidebar = () => {
    const saved = localStorage.getItem('openfox:rightSidebar')
    return saved !== null ? saved === 'true' : true
  }

  const [leftSidebarOpen, setLeftSidebarOpen] = useState(getInitialLeftSidebar)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(getInitialRightSidebar)

  const [leftMobileOpen, setLeftMobileOpen] = useState(false)
  const [rightMobileOpen, setRightMobileOpen] = useState(false)

  const [isMobile, setIsMobile] = useState(false)
  const viewport = useVisualViewport()

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const [location] = useLocation()
  const isProjectPage = /^\/p\/[^/]+$/.test(location)

  // Split view: restore the persisted pane set when landing on /split-view,
  // and collapse the layout when leaving the route. Restored panes are loaded
  // (async) before SplitView mounts so it never flashes an empty state.
  const isSplit = useIsSplit()
  const [splitReady, setSplitReady] = useState(false)
  const prevIsSplitRef = useRef(false)
  useEffect(() => {
    if (prevIsSplitRef.current && !isSplit) {
      useSessionStore.getState().exitSplitView()
    }
    prevIsSplitRef.current = isSplit
  }, [isSplit])

  useEffect(() => {
    if (!isSplit) {
      setSplitReady(false)
      return
    }
    let cancelled = false
    // Restore the persisted layout when one exists; otherwise keep whatever
    // panes were deliberately opened (e.g. via the header/home entry buttons).
    // Sessions merely visited during normal browsing are never listed as panes
    // (ensurePane does not touch openSessionIds), so no browsing history leaks
    // into the split view.
    const layout = readSplitLayout()
    const restore =
      layout && layout.openSessionIds.length > 0
        ? useSessionStore.getState().enterSplitView(layout.openSessionIds, layout.focusedSessionId ?? undefined)
        : Promise.resolve()
    restore.then(() => {
      if (!cancelled) setSplitReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [isSplit])

  const effectiveLeftOpen = isMobile ? leftMobileOpen : isProjectPage ? true : leftSidebarOpen
  const effectiveRightOpen = isMobile ? rightMobileOpen : rightSidebarOpen
  // On the split route with no panes open, the control sidebar must stay
  // visible so the user can pick a session to open; once a pane exists the
  // regular toggle takes over.
  const openPaneCount = useSessionStore((state) => state.openSessionIds.length)
  const splitControlOpen = isSplit && openPaneCount === 0 ? true : effectiveLeftOpen

  const handleLeftToggle = () => {
    if (isMobile) {
      setLeftMobileOpen(!leftMobileOpen)
    } else {
      setLeftSidebarOpen(!leftSidebarOpen)
    }
  }

  const handleRightToggle = () => {
    if (isMobile) {
      setRightMobileOpen(!rightMobileOpen)
    } else {
      setRightSidebarOpen(!rightSidebarOpen)
    }
  }

  useEffect(() => {
    if (!isMobile) {
      localStorage.setItem('openfox:leftSidebar', String(leftSidebarOpen))
    }
  }, [leftSidebarOpen, isMobile])

  useEffect(() => {
    if (!isMobile) {
      localStorage.setItem('openfox:rightSidebar', String(rightSidebarOpen))
    }
  }, [rightSidebarOpen, isMobile])

  useEffect(() => {
    if (connectionStatus === 'connected' || hasToken) {
      fetchConfig()
    }
  }, [connectionStatus, fetchConfig, hasToken])

  const showPasswordModal = useSessionStore((state) => state.showPasswordModal)
  const passwordModalRetry = useSessionStore((state) => state.passwordModalRetry)
  const submitPassword = useSessionStore((state) => state.submitPassword)
  const cancelPassword = useSessionStore((state) => state.cancelPassword)

  const [isReadonly] = useRoute('/p/:projectId/s/:sessionId/readonly')

  if (!isReadonly && connectionStatus !== 'connected' && !showPasswordModal && !hasToken) {
    return (
      <div className="h-screen flex items-center justify-center">
        <SpinnerWithText text="Connecting to server..." />
      </div>
    )
  }

  if (isReadonly) {
    return <ReadonlySessionView />
  }

  return (
    <>
      <PasswordModal
        isOpen={showPasswordModal}
        isRetry={passwordModalRetry}
        onSubmit={submitPassword}
        onCancel={cancelPassword}
      />
      <div
        className="flex flex-col"
        style={{ height: isMobile ? `calc(${viewport.offsetTop}px + ${viewport.height}px)` : '100vh' }}
      >
        <PageTitle />
        <Header onMenuClick={handleLeftToggle} onCriteriaToggle={handleRightToggle} />

        <div className="@container flex-1 flex overflow-hidden">
          <Switch>
            <Route path="/onboarding">
              <OnboardingPage />
            </Route>
            <Route path="/split-view">
              {splitReady ? <SplitView controlOpen={splitControlOpen} /> : <LoadingSpinner />}
            </Route>
            <Route path="/p/:projectId/s/:sessionId">
              <ProjectSessionView
                sidebarOpen={effectiveLeftOpen}
                onSidebarToggle={handleLeftToggle}
                rightSidebarOpen={effectiveRightOpen}
                onRightSidebarToggle={handleRightToggle}
              />
            </Route>
            <Route path="/p/:projectId/new">
              <NewSessionHandler />
            </Route>
            <Route path="/p/:projectId">
              <ProjectView sidebarOpen={effectiveLeftOpen} onSidebarToggle={handleLeftToggle} />
            </Route>
            <Route path="/">
              <HomePage />
            </Route>
          </Switch>
        </div>
      </div>
      <UpdateBanner />
      <ChangelogModal
        isOpen={showChangelog}
        onClose={() => setShowChangelog(false)}
        since={getStoredPreviousVersion() ?? undefined}
      />
    </>
  )
}

export default App
