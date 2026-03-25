import { useEffect } from 'react'
import { useSessionStore } from '../stores/session'
import { useProjectStore } from '../stores/project'
import { useSettingsStore } from '../stores/settings'
import { useNotificationSettingsStore } from '../stores/notifications'
import { wsClient } from '../lib/ws'

export function useWebSocket() {
  const connect = useSessionStore(state => state.connect)
  const connectionStatus = useSessionStore(state => state.connectionStatus)
  const handleProjectMessage = useProjectStore(state => state.handleServerMessage)
  const handleSettingsMessage = useSettingsStore(state => state.handleServerMessage)
  const loadNotificationSettings = useNotificationSettingsStore(state => state.load)

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

  // Load notification settings once connected
  useEffect(() => {
    if (connectionStatus === 'connected') {
      loadNotificationSettings()
    }
  }, [connectionStatus, loadNotificationSettings])

  return { connectionStatus }
}
