import { useEffect } from 'react'
import { Route, Switch, useRoute } from 'wouter'
import { useWebSocket } from './hooks/useWebSocket'
import { useSessionStore } from './stores/session'
import { useProjectStore } from './stores/project'
import { useConfigStore } from './stores/config'
import { Header } from './components/layout/Header'
import { Sidebar } from './components/layout/Sidebar'
import { ProjectSelector } from './components/ProjectSelector'
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
function ProjectView() {
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
      listSessions()
      clearSession()
    }
  }, [connectionStatus, projectId, currentProject?.id, loadProject, listSessions, clearSession])
  
  if (!currentProject || currentProject.id !== projectId) {
    return <LoadingSpinner />
  }
  
  return (
    <>
      <Sidebar projectId={projectId!} />
      <div className="flex-1 bg-bg-primary">
        <EmptyProjectView />
      </div>
    </>
  )
}

// Project + Session view with sidebar
function ProjectSessionView() {
  const [, params] = useRoute('/p/:projectId/s/:sessionId')
  const projectId = params?.projectId
  const sessionId = params?.sessionId
  
  const connectionStatus = useSessionStore(state => state.connectionStatus)
  const session = useSessionStore(state => state.currentSession)
  const loadSession = useSessionStore(state => state.loadSession)
  const listSessions = useSessionStore(state => state.listSessions)
  
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
    if (connectionStatus === 'connected' && sessionId && session?.id !== sessionId) {
      loadSession(sessionId)
    }
    if (connectionStatus === 'connected') {
      listSessions()
    }
  }, [connectionStatus, sessionId, session?.id, loadSession, listSessions])
  
  if (!currentProject || currentProject.id !== projectId) {
    return <LoadingSpinner />
  }
  
  if (!session || session.id !== sessionId) {
    return (
      <>
        <Sidebar projectId={projectId!} />
        <LoadingSpinner />
      </>
    )
  }
  
  return (
    <>
      <Sidebar projectId={projectId!} />
      
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
  const handleProjectMessage = useProjectStore(state => state.handleServerMessage)
  
  // Fetch config on mount
  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])
  
  // Subscribe to project messages
  useEffect(() => {
    // The project store needs to handle server messages
    // This is done via the session store's subscription, but we need to add project handling
  }, [handleProjectMessage])
  
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
      <Header />
      
      <div className="flex-1 flex overflow-hidden">
        <Switch>
          <Route path="/p/:projectId/s/:sessionId">
            <ProjectSessionView />
          </Route>
          <Route path="/p/:projectId">
            <ProjectView />
          </Route>
          <Route path="/">
            <ProjectSelector />
          </Route>
        </Switch>
      </div>
    </div>
  )
}

export default App
