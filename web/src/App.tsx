import { useEffect, useState } from 'react'
import { SETTINGS_KEYS, DISPLAY_SETTINGS_KEYS, useSettingsStore } from './stores/settings'
import { useVisualViewport } from './hooks/useVisualViewport'
import { Route, Switch, useRoute, useLocation } from 'wouter'
import { useWebSocket } from './hooks/useWebSocket'
import { useSessionStore } from './stores/session'
import { useProjectStore } from './stores/project'
import { useConfigStore } from './stores/config'
import { useThemeStore } from './stores/theme'

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
import { Spinner, SpinnerWithText } from './components/shared/Spinner'
import { PasswordModal } from './components/PasswordModal'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'

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
  const clearSession = useSessionStore((state) => state.clearSession)

  const currentProject = useProjectStore((state) => state.currentProject)

  const hasToken = hasStoredToken()
  const canLoad = connectionStatus === 'connected' || hasToken

  useEffect(() => {
    if (canLoad && projectId && currentProject?.id !== projectId) {
      useProjectStore.getState().loadProject(projectId)
    }
    if (canLoad && projectId) {
      useSessionStore.getState().listSessions(projectId)
      clearSession()
    }
  }, [canLoad, projectId, currentProject?.id, clearSession])

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
  const loadSession = useSessionStore((state) => state.loadSession)
  const listSessions = useSessionStore((state) => state.listSessions)
  const pendingSessionCreate = useSessionStore((state) => state.pendingSessionCreate)
  const error = useSessionStore((state) => state.error)
  const clearError = useSessionStore((state) => state.clearError)

  const currentProject = useProjectStore((state) => state.currentProject)
  const loadProject = useProjectStore((state) => state.loadProject)

  const hasToken = hasStoredToken()
  const canLoad = connectionStatus === 'connected' || hasToken

  useEffect(() => {
    if (canLoad && projectId && currentProject?.id !== projectId) {
      loadProject(projectId)
    }
    if (canLoad && sessionId && session?.id !== sessionId) {
      loadSession(sessionId)
    }
    if (canLoad && projectId) {
      listSessions(projectId)
    }
  }, [
    canLoad,
    projectId,
    currentProject?.id,
    loadProject,
    sessionId,
    session?.id,
    loadSession,
    listSessions,
    pendingSessionCreate,
  ])

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
      <div className="flex-1 min-w-0 bg-primary">
        <PlanPanel criteriaSidebarOpen={rightSidebarOpen} onCriteriaSidebarToggle={onRightSidebarToggle} />
      </div>
    </>
  )
}

function OnboardingPage() {
  const fetchConfig = useConfigStore((state) => state.fetchConfig)

  function handleComplete() {
    fetchConfig()
    window.history.back()
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <OnboardingWizard onComplete={handleComplete} />
    </div>
  )
}

function App() {
  const { connectionStatus } = useWebSocket()
  const fetchConfig = useConfigStore((state) => state.fetchConfig)
  const refreshProviderModels = useConfigStore((state) => state.refreshProviderModels)
  const loadDisplaySettings = useSettingsStore((state) => state.getSetting)
  const providers = useConfigStore((state) => state.providers)
  const activeProviderId = useConfigStore((state) => state.activeProviderId)
  const [, navigate] = useLocation()

  const hasToken = hasStoredToken()

  const [configFetched, setConfigFetched] = useState(false)

  useEffect(() => {
    if (connectionStatus === 'connected' || hasToken) {
      fetchConfig().then(() => {
        setConfigFetched(true)
        for (const key of DISPLAY_SETTINGS_KEYS) {
          loadDisplaySettings(key)
        }
        loadDisplaySettings(SETTINGS_KEYS.DISPLAY_THEME)
        loadDisplaySettings(SETTINGS_KEYS.DISPLAY_USER_PRESETS)
      })
    }
  }, [connectionStatus, hasToken, fetchConfig, loadDisplaySettings])

  useEffect(() => {
    if (configFetched && activeProviderId) {
      refreshProviderModels(activeProviderId).then(() => {
        fetchConfig()
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
    const { applyPreset, applyTokens } = useThemeStore.getState()
    const serverTheme = displaySettings[SETTINGS_KEYS.DISPLAY_THEME]
    const serverPresets = displaySettings[SETTINGS_KEYS.DISPLAY_USER_PRESETS]

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
      applyPreset('dark')
    }
  }, [displaySettings[SETTINGS_KEYS.DISPLAY_THEME], displaySettings[SETTINGS_KEYS.DISPLAY_USER_PRESETS]])

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

  const effectiveLeftOpen = isMobile ? leftMobileOpen : leftSidebarOpen
  const effectiveRightOpen = isMobile ? rightMobileOpen : rightSidebarOpen

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

  if (connectionStatus !== 'connected' && !showPasswordModal && !hasToken) {
    return (
      <>
        <PasswordModal isOpen={true} isRetry={passwordModalRetry} onSubmit={submitPassword} onCancel={cancelPassword} />
        <div className="h-screen flex items-center justify-center">
          <SpinnerWithText text="Connecting to server..." />
        </div>
      </>
    )
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

        <div className="flex-1 flex overflow-hidden">
          <Switch>
            <Route path="/onboarding">
              <OnboardingPage />
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
    </>
  )
}

export default App
