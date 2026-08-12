import type { SessionManager } from '../session/manager.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { StatsIdentity } from '../../shared/types.js'
import { createContextStateMessage } from '../ws/protocol.js'
import { getEventStore } from '../events/index.js'

export function getSessionMessageCount(sessionId: string): number {
  const eventStore = getEventStore()
  const events = eventStore.getEvents(sessionId)

  let count = 0
  for (const event of events) {
    if (event.type === 'message.start') {
      const data = event.data as { role: string; isSystemGenerated?: boolean }
      // System-generated messages (task reminders, auto prompts) are not
      // "real" user input — they must not count as the first user message so
      // auto session naming keys off the actual prompt.
      if (data.role === 'user' && !data.isSystemGenerated) {
        count++
      }
    }
  }

  return count
}

export function finalizeTurnCompletion(
  sessionId: string,
  sessionManager: SessionManager,
  broadcastForSession: (sessionId: string, msg: ServerMessage) => void,
): void {
  sessionManager.setRunning(sessionId, false)
  const contextState = sessionManager.getContextState(sessionId)
  broadcastForSession(sessionId, createContextStateMessage(contextState))
}

export interface RunChatTurnParams {
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  /** Re-resolve the session's LLM client per retry attempt (provider switch mid-turn). */
  getSessionLLMClient?: () => LLMClientWithModel
  statsIdentity?: StatsIdentity
  signal: AbortSignal
  onMessage: (msg: ServerMessage) => void
}

export function buildRunChatTurnParams(params: RunChatTurnParams): {
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  getSessionLLMClient?: () => LLMClientWithModel
  statsIdentity?: StatsIdentity
  signal: AbortSignal
  onMessage: (msg: ServerMessage) => void
} {
  return {
    sessionManager: params.sessionManager,
    sessionId: params.sessionId,
    llmClient: params.llmClient,
    ...(params.getSessionLLMClient ? { getSessionLLMClient: params.getSessionLLMClient } : {}),
    signal: params.signal,
    onMessage: params.onMessage,
    ...(params.statsIdentity ? { statsIdentity: params.statsIdentity } : {}),
  }
}
