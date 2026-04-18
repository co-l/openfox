import type { SessionManager } from '../session/manager.js'
import type { ServerMessage } from '../../shared/protocol.js'
import { createContextStateMessage } from '../ws/protocol.js'
import { getEventStore } from '../events/index.js'

export function getSessionMessageCount(sessionId: string): number {
  const eventStore = getEventStore()
  const events = eventStore.getEvents(sessionId)

  let count = 0
  for (const event of events) {
    if (event.type === 'message.start') {
      const data = event.data as { role: string }
      if (data.role === 'user') {
        count++
      }
    }
  }

  return count
}

export function finalizeTurnCompletion(
  sessionId: string,
  sessionManager: SessionManager,
  broadcastForSession: (sessionId: string, msg: ServerMessage) => void
): void {
  sessionManager.setRunning(sessionId, false)
  const contextState = sessionManager.getContextState(sessionId)
  broadcastForSession(sessionId, createContextStateMessage(contextState))
}