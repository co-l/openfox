import { createMessageStartEvent } from '../chat/stream-pure.js'
import type { EventStore } from '../events/store.js'

export interface NudgeMessageOptions {
  subAgentId: string
  subAgentType: string
  contextWindowId?: string
}

export function appendNudgeMessage(
  eventStore: EventStore,
  sessionId: string,
  content: string,
  currentWindowMessageOptions: Record<string, unknown> | undefined,
  options: NudgeMessageOptions,
): void {
  const msgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(msgId, 'user', content, {
    ...(currentWindowMessageOptions ?? {}),
    isSystemGenerated: true,
    messageKind: 'correction',
    subAgentId: options.subAgentId,
    subAgentType: options.subAgentType,
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: msgId } })
}