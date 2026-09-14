/**
 * Boot auto-continuation (opt-in, Settings > Advanced > "Auto-continue on boot").
 *
 * When the server starts, sessions that were running when it stopped get a
 * continuation turn queued through the standard queue → orchestrator → agent
 * loop path. Mid-generation sessions (an assistant stream left unfinalized by
 * the crash) are finalized as partial and receive the exact same "stream
 * interrupted" reminder as the live LLM-drop retry mechanism — no new core
 * turn code.
 */

import type { StoredEvent, TurnEvent } from '../events/types.js'
import { createMessageDoneEvent } from '../chat/stream-pure.js'
import { CONTINUE_PROMPT, CONTINUE_AFTER_STREAM_ERROR_PROMPT } from '../chat/agent-loop.js'
import { logger } from '../utils/logger.js'

export { CONTINUE_PROMPT, CONTINUE_AFTER_STREAM_ERROR_PROMPT }

export interface BootContinuationPlan {
  /** messageId of the partial assistant message to finalize with message.done {partial:true} */
  finalizeMessageId?: string
  /** content of the continuation message to queue for the session */
  content: string
}

/**
 * Pure decision for one stale-running session. Returns null to skip (active
 * workflow execution — a plain turn would fight the workflow state machine).
 */
export function planBootContinuation(events: StoredEvent[], hasActiveWorkflow: boolean): BootContinuationPlan | null {
  if (hasActiveWorkflow) return null
  const finalizeMessageId = findUnfinalizedAssistantMessage(events)
  return finalizeMessageId
    ? { finalizeMessageId, content: CONTINUE_AFTER_STREAM_ERROR_PROMPT }
    : { content: CONTINUE_PROMPT }
}

/**
 * The session was mid-generation when it died if its last assistant message
 * was started but never finalized (message.done / chat.done). Tool-call rounds
 * finalize the assistant bubble before executing tools, so an unfinalized one
 * means the LLM stream was cut off mid-response.
 */
function findUnfinalizedAssistantMessage(events: StoredEvent[]): string | undefined {
  let lastAssistantId: string | undefined
  const finalized = new Set<string>()

  for (const event of events) {
    switch (event.type) {
      case 'message.start': {
        const data = event.data as { role?: string; messageId: string }
        if (data.role === 'assistant') {
          lastAssistantId = data.messageId
        }
        break
      }
      case 'message.done':
      case 'chat.done': {
        const data = event.data as { messageId?: string }
        if (data.messageId) {
          finalized.add(data.messageId)
        }
        break
      }
    }
  }

  if (lastAssistantId && !finalized.has(lastAssistantId)) {
    return lastAssistantId
  }
  return undefined
}

export interface BootAutoContinueDeps {
  getEvents: (sessionId: string) => StoredEvent[]
  hasActiveWorkflow: (sessionId: string) => boolean
  appendEvent: (sessionId: string, event: TurnEvent) => void
  queueMessage: (sessionId: string, content: string) => void
}

/**
 * Apply the boot continuation plan for every stale session. Returns the number
 * of sessions queued for continuation.
 */
export function runBootAutoContinuations(sessionIds: string[], deps: BootAutoContinueDeps): number {
  let continued = 0

  for (const sessionId of sessionIds) {
    const plan = planBootContinuation(deps.getEvents(sessionId), deps.hasActiveWorkflow(sessionId))
    if (!plan) {
      logger.debug('Skipping boot auto-continuation', { sessionId })
      continue
    }

    if (plan.finalizeMessageId) {
      deps.appendEvent(sessionId, createMessageDoneEvent(plan.finalizeMessageId, { partial: true }))
    }
    deps.queueMessage(sessionId, plan.content)
    continued++
  }

  return continued
}
