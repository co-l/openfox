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

// Centered spinner for loading states
function LoadingSpinner() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Spinner />
    </div>
  )
}

// Project view with sidebar (no session selected)
function ProjectView({ sidebarOpen, onSidebarToggle }: { sidebarOpen: boolean, onSidebarToggle: () => void }) {
  const [, params] = useRoute('/p/:projectId')
  const projectId = params?.projectId

  const connectionStatus = useSessionStore(state => state.connectionStatus)
  const listSessions = useSessionStore(state => state.listSessions)
  const clearSession = useSessionStore(state => state.clearSession)

  const currentProject = useProjectStore(state => state.currentProject)
  const loadProject = useProjectStore(state => state.loadProject)

  // Load project and sessions when entering project view
  useEffect(() => {
    if (connectionStatus === 'connected' && projectId) {
      if (currentProject?.id !== projectId) {
        loadProject(projectId)
      }
      listSessions(projectId)
      clearSession()
    }
  }, [connectionStatus, projectId, currentProject?.id, loadProject, listSessions, clearSession])

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

// Project + Session view with sidebar
function ProjectSessionView({ 
  sidebarOpen, 
  onSidebarToggle,
}: {
  sidebarOpen: boolean, 
  onSidebarToggle: () => void,
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

  // Load project if needed
  useEffect(() => {
    if (connectionStatus === 'connected' && projectId && currentProject?.id !== projectId) {
      loadProject(projectId)
    }
  }, [connectionStatus, projectId, currentProject?.id, loadProject])

  // Load session and session list
  useEffect(() => {
    if (connectionStatus === 'connected' && sessionId && session?.id !== sessionId && !pendingSessionCreate) {
      loadSession(sessionId)
    }
    if (connectionStatus === 'connected' && projectId) {
      listSessions(projectId)
    }
  }, [connectionStatus, sessionId, session?.id, loadSession, listSessions, pendingSessionCreate, projectId])

  // Redirect to project view if session not found
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

      {/* Main content area - single unified chat panel */}
      <div className="flex-1 min-w-0 bg-bg-primary">
        <PlanPanel />
      </div>
    </>
  )
}

function App() {
  const { connectionStatus } = useWebSocket()
  const fetchConfig = useConfigStore(state => state.fetchConfig)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Fetch config on mount
  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  // Block UI until connected
  if (connectionStatus !== 'connected') {
    return (
      <div className="h-screen flex items-center justify-center">
        <SpinnerWithText text={connectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Connecting to server...'} />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col">
      <PageTitle />
      <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

      <div className="flex-1 flex overflow-hidden">
        <Switch>
          <Route path="/p/:projectId/s/:sessionId">
            <ProjectSessionView 
              sidebarOpen={sidebarOpen} 
              onSidebarToggle={() => setSidebarOpen(false)}
            />
          </Route>
          <Route path="/p/:projectId/new">
            <NewSessionHandler />
          </Route>
          <Route path="/p/:projectId">
            <ProjectView 
              sidebarOpen={sidebarOpen} 
              onSidebarToggle={() => setSidebarOpen(false)}
            />
          </Route>
          <Route path="/">
            <HomePage />
          </Route>
        </Switch>
      </div>
    </div>
  )
}

export default App