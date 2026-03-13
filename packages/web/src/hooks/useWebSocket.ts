import { useEffect } from 'react'
import { useSessionStore } from '../stores/session'
import { useProjectStore } from '../stores/project'
import { wsClient } from '../lib/ws'

export function useWebSocket() {
  const connect = useSessionStore(state => state.connect)
  const connected = useSessionStore(state => state.connected)
  const connecting = useSessionStore(state => state.connecting)
  const handleProjectMessage = useProjectStore(state => state.handleServerMessage)
  
  useEffect(() => {
    connect()
  }, [connect])
  
  // Subscribe project store to server messages
  useEffect(() => {
    if (connected) {
      const unsubscribe = wsClient.subscribe(handleProjectMessage)
      return unsubscribe
    }
  }, [connected, handleProjectMessage])
  
  return { connected, connecting }
}
