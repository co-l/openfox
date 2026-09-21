import { ScrollArea } from './components/shared/ScrollArea'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SETTINGS_KEYS,
  DISPLAY_SETTINGS_KEYS,
  fetchSettingsBulk,
  mcpServersResource,
  readConfig,
} from './lib/resources'
import { useSetting } from './hooks/useSetting'
import { useVisualViewport } from './hooks/useVisualViewport'
import { Route, Switch, useRoute, useLocation } from 'wouter'
import { useWebSocket } from './hooks/useWebSocket'
import { useSessionStore } from './stores/session'
import { useConfigStore } from './stores/config'
import { useLocaleStore } from './stores/locale'
import { useCurrentProject } from './hooks/useCurrentProject'
import { useProviders } from './hooks/useProviders'
import { useThemeStore } from './stores/theme'
import { useProjectLoader } from './hooks/useProjectLoader'
import { useSessionLoader } from './hooks/useSessionLoader'
import { computeSidebarVisibility, FEED_MIN_WIDTH } from './lib/sidebar-visibility'
import { useSidebarStore } from './stores/sidebar'
import { hasStoredToken } from './lib/api'

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
import { EffortChangeGateProvider } from './components/plan/EffortChangeGate'
import { CrossSessionConfirmationBanner } from './components/shared/CrossSessionConfirmationBanner'
import { UpdateBanner } from './components/UpdateBanner'
import { PluginPanelHost } from './components/plugins/PluginPanelHost'
import { NotificationToasts } from './components/notifications/NotificationToasts'
import { ChangelogModal } from './components/ChangelogModal'
import { getStoredLastVersion, getStoredPreviousVersion, isVersionNewerThan, trackVersion } from './lib/versionTracking'

function LoadingSpinner() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Spinner />
    </div>
  )
}

function ProjectView({
  sidebarOpen,
  sidebarOverlay,
  onSidebarToggle,
}: {
  sidebarOpen: boolean
  sidebarOverlay: boolean
  onSidebarToggle: () => void
}) {
  const [, params] = useRoute('/p/:projectId')
  const projectId = params?.projectId

  const connectionStatus = useSessionStore((state) => state.connectionStatus)
  const currentProject = useCurrentProject()

  const hasToken = hasStoredToken()
  const canLoad = connectionStatus === 'connected' || hasToken

  useProjectLoader({ canLoad, projectId, currentProjectId: currentProject?.id })

  if (!currentProject || currentProject.id !== projectId) {
    return <LoadingSpinner />
  }

  return (
    <>
      <Sidebar projectId={projectId!} isOpen={sidebarOpen} overlay={sidebarOverlay} onClose={onSidebarToggle} />
      <div className="flex-1 min-w-0 bg-primary">
        <EmptyProjectView />
      </div>
    </>
  )
}

function ProjectSessionView({
  sidebarOpen,
  sidebarOverlay,
  onSidebarToggle,
  rightSidebarOpen,
  rightSidebarOverlay,
  onRightSidebarToggle,
}: {
  sidebarOpen: boolean
  sidebarOverlay: boolean
  onSidebarToggle: () => void
  rightSidebarOpen: boolean
  rightSidebarOverlay: boolean
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
  const currentProject = useCurrentProject()

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
      <Sidebar projectId={projectId!} isOpen={sidebarOpen} overlay={sidebarOverlay} onClose={onSidebarToggle} />
      <div className="flex-1 min-w-0 bg-primary flex flex-col">
        <CrossSessionConfirmationBanner projectId={projectId} />
        <PlanPanel
          criteriaSidebarOpen={rightSidebarOpen}
          criteriaSidebarOverlay={rightSidebarOverlay}
          onCriteriaSidebarToggle={onRightSidebarToggle}
        />
      </div>
    </>
  )
}

function OnboardingPage() {
  const fetchConfig = useConfigStore((state) => state.fetchConfig)
  const applyLocale = useLocaleStore((state) => state.applyLocale)
  const [, navigate] = useLocation()

  async function handleComplete() {
    await fetchConfig()
    applyLocale(readConfig()?.locale)
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
  const applyLocale = useLocaleStore((state) => state.applyLocale)
  const { providers, activeProviderId } = useProviders()
  const [, navigate] = useLocation()

  const hasToken = hasStoredToken()

  const [configFetched, setConfigFetched] = useState(false)

  useEffect(() => {
    if (connectionStatus === 'connected' || hasToken) {
      fetchConfig().then(() => {
        setConfigFetched(true)
        applyLocale(readConfig()?.locale)
        // Warm the settings cache in one batched request (write-through into
        // the per-key entries) so display prefs land together, no flash of
        // defaults. MCP servers are eager-loaded for the chat MCP indicator.
        void fetchSettingsBulk([
          ...DISPLAY_SETTINGS_KEYS,
          SETTINGS_KEYS.DISPLAY_THEME,
          SETTINGS_KEYS.DISPLAY_USER_PRESETS,
          SETTINGS_KEYS.DISPLAY_CUSTOM_CSS,
          SETTINGS_KEYS.KEYBINDINGS,
          SETTINGS_KEYS.FEATURES_PER_SESSION_MCP,
        ])
        void mcpServersResource.refresh()
      })
    }
  }, [connectionStatus, hasToken, fetchConfig])

  useEffect(() => {
    if (configFetched && activeProviderId) {
      refreshProviderModels(activeProviderId).then(() => {
        // Only refresh config if we don't already have a valid defaultModelSelection
        // for this provider (avoids overwriting optimistic updates)
        const currentSelection = readConfig()?.defaultModelSelection
        const selectionProvider = currentSelection ? currentSelection.split('/')[0] : null
        if (selectionProvider !== activeProviderId) {
          fetchConfig()
        }
      })
    }
  }, [configFetched, activeProviderId, refreshProviderModels, fetchConfig])

  // Theme-related settings are only fetched once the app is authenticated and
  // the config has been loaded — the unauthenticated login page must not fire
  // per-key settings requests (pre-login 401 noise). The batched warm-up below
  // fills these same keys after connect, so gating here costs nothing once in.
  const themeSetting = useSetting(SETTINGS_KEYS.DISPLAY_THEME, '', configFetched).value
  const userPresetsSetting = useSetting(SETTINGS_KEYS.DISPLAY_USER_PRESETS, '', configFetched).value
  const followSystemSetting = useSetting(SETTINGS_KEYS.DISPLAY_FOLLOW_SYSTEM_THEME, '', configFetched).value
  const customCssSetting = useSetting(SETTINGS_KEYS.DISPLAY_CUSTOM_CSS, '', configFetched).value
  const showChangelogSetting = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE, '', configFetched).value

  useEffect(() => {
    if (configFetched && providers.length === 0) {
      navigate('/onboarding')
    }
  }, [configFetched, providers.length])

  useEffect(() => {
    // Server-reconciled theme only matters once authenticated and the config
    // (and the batched settings warm-up) have landed. Before that the store's
    // synchronous localStorage theme already applies; running this early would
    // treat the '' fallbacks as real values (e.g. PUT followSystemTheme=false).
    if (!configFetched) return
    const { applyPreset, applyTokens, setFollowSystemTheme, initSystemThemeListener } = useThemeStore.getState()
    const serverTheme = themeSetting
    const serverPresets = userPresetsSetting
    const serverFollowSystem = followSystemSetting

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
  }, [configFetched, themeSetting, userPresetsSetting, followSystemSetting])

  // Inject custom CSS into a <style> tag
  useEffect(() => {
    const css = customCssSetting
    let styleTag = document.getElementById('custom-css') as HTMLStyleElement | null
    if (!styleTag) {
      styleTag = document.createElement('style')
      styleTag.id = 'custom-css'
      document.head.appendChild(styleTag)
    }
    styleTag.textContent = css
  }, [customCssSetting])

  const [showChangelog, setShowChangelog] = useState(false)

  useEffect(() => {
    const setting = showChangelogSetting
    if (setting === '') return
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
      const currentVersion = readConfig()?.version ?? null
      const lastVersion = getStoredLastVersion()
      if (isVersionNewerThan(currentVersion, lastVersion)) {
        shouldShow = true
      }
      trackVersion(currentVersion)
    }

    if (shouldShow) {
      setShowChangelog(true)
    }
  }, [showChangelogSetting, configFetched])

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

  // Transient "explicitly open on tight space" desktop flags: a sidebar opens
  // as an overlay when it cannot fit inline without violating the feed floor.
  const [leftOverlayOpen, setLeftOverlayOpen] = useState(false)
  const [rightOverlayOpen, setRightOverlayOpen] = useState(false)

  // Mobile (<768) overlay open states.
  const [leftMobileOpen, setLeftMobileOpen] = useState(false)
  const [rightMobileOpen, setRightMobileOpen] = useState(false)

  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const viewport = useVisualViewport()
  const isMobile = viewportWidth < 768

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
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

  const leftWidth = useSidebarStore((state) => state.leftWidth)
  const rightWidth = useSidebarStore((state) => state.rightWidth)

  const visibility = useMemo(
    () =>
      computeSidebarVisibility({
        availableWidth: viewportWidth,
        leftWidth,
        rightWidth,
        feedMinWidth: FEED_MIN_WIDTH,
        preferred: { left: leftSidebarOpen, right: rightSidebarOpen },
        overlayOpen: { left: leftOverlayOpen, right: rightOverlayOpen },
      }),
    [viewportWidth, leftWidth, rightWidth, leftSidebarOpen, rightSidebarOpen, leftOverlayOpen, rightOverlayOpen],
  )

  const effectiveLeftOpen = isMobile ? leftMobileOpen : isProjectPage ? true : visibility.left !== 'closed'
  const effectiveRightOpen = isMobile ? rightMobileOpen : visibility.right !== 'closed'
  const leftOverlay = isMobile || (!isProjectPage && visibility.left === 'overlay')
  const rightOverlay = isMobile || visibility.right === 'overlay'
  // On the split route with no panes open, the control sidebar must stay
  // visible so the user can pick a session to open; once a pane exists the
  // regular toggle takes over.
  const openPaneCount = useSessionStore((state) => state.openSessionIds.length)
  const splitControlOpen = isSplit && openPaneCount === 0 ? true : effectiveLeftOpen

  // An explicitly-opened desktop overlay is transient: once its sidebar can be
  // inline again (or the window drops below the mobile threshold where mobile
  // states take over), the overlay no longer applies. Drop it so a stale flag
  // cannot silently pop the sidebar back open on a later resize.
  useEffect(() => {
    if (leftOverlayOpen && (isMobile || visibility.left !== 'overlay')) {
      setLeftOverlayOpen(false)
    }
    if (rightOverlayOpen && (isMobile || visibility.right !== 'overlay')) {
      setRightOverlayOpen(false)
    }
  }, [isMobile, visibility.left, visibility.right, leftOverlayOpen, rightOverlayOpen])

  const handleLeftToggle = () => {
    if (isMobile) {
      setLeftMobileOpen(!leftMobileOpen)
    } else if (isProjectPage || visibility.leftFits) {
      setLeftSidebarOpen(!leftSidebarOpen)
    } else {
      setLeftOverlayOpen(visibility.left !== 'overlay')
    }
  }

  const handleRightToggle = () => {
    if (isMobile) {
      setRightMobileOpen(!rightMobileOpen)
    } else if (visibility.rightFits) {
      setRightSidebarOpen(!rightSidebarOpen)
    } else {
      setRightOverlayOpen(visibility.right !== 'overlay')
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
    <EffortChangeGateProvider>
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
                sidebarOverlay={leftOverlay}
                onSidebarToggle={handleLeftToggle}
                rightSidebarOpen={effectiveRightOpen}
                rightSidebarOverlay={rightOverlay}
                onRightSidebarToggle={handleRightToggle}
              />
            </Route>
            <Route path="/p/:projectId/new">
              <NewSessionHandler />
            </Route>
            <Route path="/p/:projectId">
              <ProjectView
                sidebarOpen={effectiveLeftOpen}
                sidebarOverlay={leftOverlay}
                onSidebarToggle={handleLeftToggle}
              />
            </Route>
            <Route path="/">
              <HomePage />
            </Route>
          </Switch>
        </div>
      </div>
      <UpdateBanner />
      <PluginPanelHost />
      <NotificationToasts />
      <ChangelogModal
        isOpen={showChangelog}
        onClose={() => setShowChangelog(false)}
        since={getStoredPreviousVersion() ?? undefined}
      />
    </EffortChangeGateProvider>
  )
}

export default App
