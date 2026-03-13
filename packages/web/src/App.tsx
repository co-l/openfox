import { useEffect } from 'react'
import { Route, Switch, useRoute } from 'wouter'
import { useWebSocket } from './hooks/useWebSocket'
import { useSessionStore } from './stores/session'
import { useConfigStore } from './stores/config'
import { Header } from './components/layout/Header'
import { SessionSelector } from './components/SessionSelector'
import { PlanPanel } from './components/plan/PlanPanel'
import { ExecutionPanel } from './components/execution/ExecutionPanel'
import { MetricsPanel } from './components/metrics/MetricsPanel'

function HomeView() {
  const clearSession = useSessionStore(state => state.clearSession)
  
  // Clear session when arriving at home
  useEffect(() => {
    clearSession()
  }, [clearSession])
  
  return (
    <div className="flex-1">
      <SessionSelector />
    </div>
  )
}

function SessionView() {
  const [, params] = useRoute('/session/:id')
  const sessionId = params?.id
  const session = useSessionStore(state => state.currentSession)
  const loadSession = useSessionStore(state => state.loadSession)
  const connected = useSessionStore(state => state.connected)
  
  // Load session from URL on mount or when sessionId changes
  useEffect(() => {
    if (connected && sessionId && session?.id !== sessionId) {
      loadSession(sessionId)
    }
  }, [connected, sessionId, session?.id, loadSession])
  
  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full" />
      </div>
    )
  }
  
  return (
    <>
      {/* Main content area */}
      <div className="flex-1 bg-bg-primary">
        {(session.phase === 'idle' || session.phase === 'planning') && (
          <PlanPanel />
        )}
        {(session.phase === 'executing' || session.phase === 'validating' || session.phase === 'completed') && (
          <ExecutionPanel />
        )}
      </div>
      
      {/* Metrics sidebar */}
      <div className="w-64 bg-bg-secondary border-l border-border">
        <MetricsPanel />
      </div>
    </>
  )
}

function App() {
  const { connected, connecting } = useWebSocket()
  const fetchConfig = useConfigStore(state => state.fetchConfig)
  
  // Fetch config on mount
  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])
  
  if (connecting) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full mx-auto mb-4" />
          <div className="text-text-secondary">Connecting to server...</div>
        </div>
      </div>
    )
  }
  
  if (!connected) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-accent-error text-4xl mb-4">!</div>
          <div className="text-text-primary mb-2">Connection Failed</div>
          <div className="text-text-secondary text-sm">
            Make sure the OpenFox server is running on port 3000
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="h-screen flex flex-col">
      <Header />
      
      <div className="flex-1 flex overflow-hidden">
        <Switch>
          <Route path="/session/:id">
            <SessionView />
          </Route>
          <Route path="/">
            <HomeView />
          </Route>
        </Switch>
      </div>
    </div>
  )
}

export default App
