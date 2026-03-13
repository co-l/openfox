import { useEffect } from 'react'
import { useSessionStore } from '../stores/session'

export function useWebSocket() {
  const connect = useSessionStore(state => state.connect)
  const connected = useSessionStore(state => state.connected)
  const connecting = useSessionStore(state => state.connecting)
  
  useEffect(() => {
    connect()
  }, [connect])
  
  return { connected, connecting }
}
