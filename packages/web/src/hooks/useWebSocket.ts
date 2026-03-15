import { useEffect } from 'react'
import { useSessionStore } from '../stores/session'
import { useProjectStore } from '../stores/project'
import { useSettingsStore } from '../stores/settings'
import { wsClient } from '../lib/ws'

export function useWebSocket() {
  const connect = useSessionStore(state => state.connect)
  const connectionStatus = useSessionStore(state => state.connectionStatus)
  const handleProjectMessage = useProjectStore(state => state.handleServerMessage)
  const handleSettingsMessage = useSettingsStore(state => state.handleServerMessage)
  
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
  
  // Subscribe settings store to server messages
  useEffect(() => {
    if (connectionStatus === 'connected') {
      const unsubscribe = wsClient.subscribe(handleSettingsMessage)
      return unsubscribe
    }
  }, [connectionStatus, handleSettingsMessage])
  
  return { connectionStatus }
}
