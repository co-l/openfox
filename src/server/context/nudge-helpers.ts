import type { InjectedFile } from '../../shared/types.js'
import { createMessageStartEvent } from '../chat/stream-pure.js'
import type { RequestContextMessage } from '../chat/request-context.js'
import type { ToolRegistry } from '../tools/types.js'
import type { EventStore } from '../events/store.js'

export interface NudgeMessageOptions {
  subAgentId: string
  subAgentType: string
  contextWindowId?: string
}

export function buildPromptContextForNudge(
  systemPrompt: string,
  injectedFiles: InjectedFile[],
  userMessage: string,
  messages: RequestContextMessage[],
  tools: ToolRegistry['definitions'],
) {
  return {
    systemPrompt,
    injectedFiles,
    userMessage,
    messages: messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'tool',
      content: m.content,
      source: m.source,
    })),
    tools: tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),
    requestOptions: { toolChoice: 'auto' as const, disableThinking: true },
  }
}

export function appendNudgeMessage(
  eventStore: EventStore,
  sessionId: string,
  content: string,
  currentWindowMessageOptions: Record<string, unknown> | undefined,
  options: NudgeMessageOptions,
): void {
  const msgId = crypto.randomUUID()
  eventStore.append(
    sessionId,
    createMessageStartEvent(msgId, 'user', content, {
      ...(currentWindowMessageOptions ?? {}),
      isSystemGenerated: true,
      messageKind: 'correction',
      subAgentId: options.subAgentId,
      subAgentType: options.subAgentType,
    }),
  )
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: msgId } })
}
