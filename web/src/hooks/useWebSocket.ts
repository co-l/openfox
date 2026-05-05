import { useEffect } from 'react'
import { useSessionStore } from '../stores/session'
import { useNotificationSettingsStore } from '../stores/notifications'

export function useWebSocket() {
  const connect = useSessionStore((state) => state.connect)
  const connectionStatus = useSessionStore((state) => state.connectionStatus)
  const loadNotificationSettings = useNotificationSettingsStore((state) => state.load)

  useEffect(() => {
    connect()
  }, [connect])

  // Load notification settings once connected
  useEffect(() => {
    if (connectionStatus === 'connected') {
      loadNotificationSettings()
    }
  }, [connectionStatus, loadNotificationSettings])

  return { connectionStatus }
}
