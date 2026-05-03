import type { InjectedFile } from '../../shared/types.js'
import { createMessageStartEvent, createMessageDoneEvent } from '../chat/stream-pure.js'
import type { RequestContextMessage } from '../chat/request-context.js'
import type { ToolRegistry } from '../tools/types.js'
import type { EventStore } from '../events/store.js'
import type { LLMExecutor } from './llm-executor.js'

export interface ApplyNudgeOptions extends AppendNudgedDoneEventOptions {
  executor: LLMExecutor
}

export function applyNudge(options: ApplyNudgeOptions): void {
  appendNudgedDoneEvent(options)
  options.executor.addMessage({ role: 'user', content: options.nudgeContent, source: 'runtime' })
}

export interface NudgeMessageOptions {
  subAgentId: string
  subAgentType: string
  contextWindowId?: string
}

export interface AppendNudgedDoneEventOptions {
  assistantMsgId: string
  systemPrompt: string
  injectedFiles: InjectedFile[]
  prompt: string
  messages: RequestContextMessage[]
  tools: ToolRegistry['definitions']
  nudgeContent: string
  eventStore: EventStore
  sessionId: string
  currentWindowMessageOptions: Record<string, unknown> | undefined
  subAgentId: string
  subAgentType: string
}

export function appendNudgedDoneEvent(options: AppendNudgedDoneEventOptions): string {
  const { eventStore, sessionId } = options
  const nudgeMsgId = crypto.randomUUID()

  eventStore.append(
    sessionId,
    createMessageDoneEvent(options.assistantMsgId, {
      segments: [],
      promptContext: buildPromptContextForNudge(
        options.systemPrompt,
        options.injectedFiles,
        options.prompt,
        options.messages,
        options.tools,
      ),
    }),
  )

  const contextWindowId = options.currentWindowMessageOptions?.['contextWindowId'] as string | undefined
  const startEventOptions = {
    isSystemGenerated: true,
    messageKind: 'correction' as const,
    subAgentId: options.subAgentId,
    subAgentType: options.subAgentType,
    ...(contextWindowId !== undefined && { contextWindowId }),
  }
  eventStore.append(sessionId, createMessageStartEvent(nudgeMsgId, 'user', options.nudgeContent, startEventOptions))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: nudgeMsgId } })

  return nudgeMsgId
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
