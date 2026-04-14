import { useEffect, useState } from 'react'
import { Route, Switch, useRoute, useLocation } from 'wouter'
import { useWebSocket } from './hooks/useWebSocket'
import { useSessionStore } from './stores/session'
import { useProjectStore } from './stores/project'
import { useConfigStore } from './stores/config'
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

function ProjectView({ sidebarOpen, onSidebarToggle }: { sidebarOpen: boolean, onSidebarToggle: () => void }) {
  const [, params] = useRoute('/p/:projectId')
  const projectId = params?.projectId

  const connectionStatus = useSessionStore(state => state.connectionStatus)
  const listSessions = useSessionStore(state => state.listSessions)
  const clearSession = useSessionStore(state => state.clearSession)

  const currentProject = useProjectStore(state => state.currentProject)
  const loadProject = useProjectStore(state => state.loadProject)

  const hasToken = hasStoredToken()
  const canLoad = connectionStatus === 'connected' || hasToken

  useEffect(() => {
    if (canLoad && projectId) {
      if (currentProject?.id !== projectId) {
        loadProject(projectId)
      }
      listSessions(projectId)
      clearSession()
    }
  }, [canLoad, projectId, currentProject?.id, loadProject, listSessions, clearSession])

  if (!currentProject || currentProject.id !== projectId) {
    return <LoadingSpinner />
  }

  return (
    <>
      <Sidebar projectId={projectId!} isOpen={sidebarOpen} onClose={onSidebarToggle} />
      <div className="flex-1 min-w-0 bg-bg-primary">
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

  const connectionStatus = useSessionStore(state => state.connectionStatus)
  const session = useSessionStore(state => state.currentSession)
  const loadSession = useSessionStore(state => state.loadSession)
  const listSessions = useSessionStore(state => state.listSessions)
  const pendingSessionCreate = useSessionStore(state => state.pendingSessionCreate)
  const error = useSessionStore(state => state.error)
  const clearError = useSessionStore(state => state.clearError)

  const currentProject = useProjectStore(state => state.currentProject)
  const loadProject = useProjectStore(state => state.loadProject)

  const hasToken = hasStoredToken()
  const canLoad = connectionStatus === 'connected' || hasToken

  useEffect(() => {
    if (canLoad && projectId && currentProject?.id !== projectId) {
      loadProject(projectId)
    }
  }, [canLoad, projectId, currentProject?.id, loadProject])

  useEffect(() => {
    if (canLoad && sessionId && session?.id !== sessionId && !pendingSessionCreate) {
      loadSession(sessionId)
    }
    if (canLoad && projectId) {
      listSessions(projectId)
    }
  }, [canLoad, sessionId, session?.id, loadSession, listSessions, pendingSessionCreate, projectId])

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
      <div className="flex-1 min-w-0 bg-bg-primary">
        <PlanPanel criteriaSidebarOpen={rightSidebarOpen} onCriteriaSidebarToggle={onRightSidebarToggle} />
      </div>
    </>
  )
}

function OnboardingPage() {
  const fetchConfig = useConfigStore(state => state.fetchConfig)

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
  const fetchConfig = useConfigStore(state => state.fetchConfig)
  const providers = useConfigStore(state => state.providers)
  const [, navigate] = useLocation()

  const hasToken = hasStoredToken()

  const [configFetched, setConfigFetched] = useState(false)

  useEffect(() => {
    if (connectionStatus === 'connected' || hasToken) {
      fetchConfig().then(() => {
        setConfigFetched(true)
      })
    }
  }, [connectionStatus, hasToken, fetchConfig])

  useEffect(() => {
    if (configFetched && providers.length === 0) {
      navigate('/onboarding')
    }
  }, [configFetched, providers.length])

  const getInitialLeftSidebar = () => {
    const saved = localStorage.getItem('openfox:leftSidebar')
    return saved !== null ? saved === 'true' : false
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

  const showPasswordModal = useSessionStore(state => state.showPasswordModal)
  const passwordModalRetry = useSessionStore(state => state.passwordModalRetry)
  const submitPassword = useSessionStore(state => state.submitPassword)
  const cancelPassword = useSessionStore(state => state.cancelPassword)

  if (connectionStatus !== 'connected' && !showPasswordModal && !hasToken) {
    return (
      <>
        <PasswordModal
          isOpen={true}
          isRetry={passwordModalRetry}
          onSubmit={submitPassword}
          onCancel={cancelPassword}
        />
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
      <div className="h-screen flex flex-col">
        <PageTitle />
        <Header
          onMenuClick={handleLeftToggle}
          onCriteriaToggle={handleRightToggle}
        />

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
              <ProjectView
                sidebarOpen={effectiveLeftOpen}
                onSidebarToggle={handleLeftToggle}
              />
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