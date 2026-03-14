import { useEffect } from 'react'
import { useSessionStore } from '../stores/session'
import { useProjectStore } from '../stores/project'
import { wsClient } from '../lib/ws'

export function useWebSocket() {
  const connect = useSessionStore(state => state.connect)
  const connectionStatus = useSessionStore(state => state.connectionStatus)
  const handleProjectMessage = useProjectStore(state => state.handleServerMessage)
  
  useEffect(() => {
    connect()
  }, [connect])
  
  // Subscribe project store to server messages
  useEffect(() => {
    if (connectionStatus === 'connected') {
      const unsubscribe = wsClient.subscribe(handleProjectMessage)
      return unsubscribe
    }
  }, [connectionStatus, handleProjectMessage])
  
  return { connectionStatus }
}
