import { useRef, useEffect } from 'react'
import { useSessionStore } from '../../stores/session'
import { useScopedContext } from '../../stores/session/session-scope'

/**
 * When a "Rebase system prompt" update was queued for this session while it
 * was running, fire it as soon as the session stops running.
 */
export function useQueuedRebaseTrigger() {
  const { sessionId, currentSession } = useScopedContext()
  const pendingUpdate = useSessionStore((state) => state.pendingUpdate)
  const triggerPendingUpdate = useSessionStore((state) => state.triggerPendingUpdate)
  const prevIsRunning = useRef(false)

  useEffect(() => {
    const isRunning = currentSession?.isRunning ?? false
    if (prevIsRunning.current && !isRunning && pendingUpdate && pendingUpdate === sessionId) {
      triggerPendingUpdate()
    }
    prevIsRunning.current = isRunning
  }, [currentSession?.isRunning, pendingUpdate, sessionId, triggerPendingUpdate])
}
