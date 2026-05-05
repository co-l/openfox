/**
 * Generic event application helpers
 * Extracted to avoid duplication between Message[] and SnapshotMessage[] contexts
 */

import type { ToolCall, ToolResult, PreparingToolCall } from '../../shared/types.js'
import type { TurnEvent } from './types.js'

export interface FormatRetry {
  attempt: number
  maxAttempts: number
  timestamp: number
}

export interface MessageFragment {
  tokenCount?: number
  contextWindowId?: string
  subAgentId?: string
  subAgentType?: string
  isSystemGenerated?: boolean
  messageKind?: 'correction' | 'auto-prompt' | 'context-reset' | 'task-completed' | 'workflow-started' | 'command'
  isCompactionSummary?: boolean
  attachments?: unknown[]
  metadata?: unknown
}

function extractMessageOptionalFields(data: {
  tokenCount?: number
  contextWindowId?: string
  subAgentId?: string
  subAgentType?: string
  isSystemGenerated?: boolean
  messageKind?: string
  isCompactionSummary?: boolean
  attachments?: unknown[]
  metadata?: unknown
}): Record<string, unknown> {
  return {
    ...(data.tokenCount !== undefined && { tokenCount: data.tokenCount }),
    ...(data.contextWindowId !== undefined && { contextWindowId: data.contextWindowId }),
    ...(data.subAgentId !== undefined && { subAgentId: data.subAgentId }),
    ...(data.subAgentType !== undefined && { subAgentType: data.subAgentType }),
    ...(data.isSystemGenerated !== undefined && { isSystemGenerated: data.isSystemGenerated }),
    ...(data.messageKind !== undefined && { messageKind: data.messageKind }),
    ...(data.isCompactionSummary !== undefined && { isCompactionSummary: data.isCompactionSummary }),
    ...(data.attachments !== undefined && { attachments: data.attachments }),
    ...(data.metadata !== undefined && { metadata: data.metadata }),
  }
}

export function createMessageStartData(
  data: Extract<TurnEvent, { type: 'message.start' }>['data'],
  timestamp: string | number,
): Omit<Extract<TurnEvent, { type: 'message.start' }>['data'], 'role' | 'content' | 'messageId'> & {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: string | number
  isStreaming: boolean
} {
  const isUserOrSystem = data.role === 'user' || data.role === 'system'
  return {
    id: data.messageId,
    role: data.role,
    content: data.content ?? '',
    timestamp,
    isStreaming: !isUserOrSystem,
    ...extractMessageOptionalFields(data),
  }
}

export interface ToolCallWithResult extends ToolCall {
  result?: ToolResult
  streamingOutput?: Array<{ stream: 'stdout' | 'stderr'; content: string; timestamp: number }>
}

export function attachToolCallToMessage(msg: { toolCalls?: ToolCallWithResult[] }, toolCall: ToolCall): void {
  const existing = msg.toolCalls ?? []
  const newTc = { ...toolCall } as unknown as ToolCallWithResult
  msg.toolCalls = [...existing, newTc]
}

export function attachToolResultToMessage(
  msg: { toolCalls?: ToolCallWithResult[] },
  toolCallId: string,
  result: ToolResult,
): void {
  if (msg.toolCalls) {
    const toolCall = msg.toolCalls.find((tc) => tc.id === toolCallId)
    if (toolCall) {
      toolCall.result = result
    }
  }
}

export function updateMessageDelta(msg: { content: string }, content: string): void {
  msg.content += content
}

export function updateMessageThinking(msg: { thinkingContent?: string }, content: string): void {
  msg.thinkingContent = (msg.thinkingContent ?? '') + content
}

export function updateMessageDone(
  msg: {
    isStreaming?: boolean
    stats?: unknown
    segments?: unknown[]
    partial?: boolean
    promptContext?: unknown
    tokenCount?: number
  },
  data: Extract<TurnEvent, { type: 'message.done' }>['data'],
): void {
  msg.isStreaming = false
  if (data.stats) msg.stats = data.stats
  if (data.segments) msg.segments = data.segments
  if (data.partial) msg.partial = true
  if (data.promptContext) msg.promptContext = data.promptContext
  if (data.tokenCount !== undefined) msg.tokenCount = data.tokenCount
}

export function applyEvents<
  T extends {
    id: string
    role: string
    content: string
    timestamp: string | number
    isStreaming?: boolean
    toolCalls?: ToolCallWithResult[]
    thinkingContent?: string
    stats?: unknown
    segments?: unknown[]
    partial?: boolean
    promptContext?: unknown
    tokenCount?: number
    contextWindowId?: string
    subAgentId?: string
    subAgentType?: string
    isSystemGenerated?: boolean
    messageKind?: string
    isCompactionSummary?: boolean
    attachments?: unknown[]
    metadata?: unknown
    preparingToolCalls?: PreparingToolCall[]
    formatRetries?: FormatRetry[]
    isComplete?: boolean
    completeReason?: 'complete' | 'stopped' | 'error' | 'waiting_for_user'
  },
>(
  initialMessages: T[],
  events: import('./types.js').StoredEvent[],
  options: {
    timestampAsNumber?: boolean
  },
): T[] {
  const messages = new Map(initialMessages.map((message) => [message.id, deepCloneMessage(message) as T]))

  for (const event of events) {
    switch (event.type) {
      case 'message.start': {
        const data = event.data as Extract<TurnEvent, { type: 'message.start' }>['data']
        const isUserOrSystem = data.role === 'user' || data.role === 'system'
        const timestamp = options.timestampAsNumber
          ? typeof event.timestamp === 'number'
            ? event.timestamp
            : Date.now()
          : new Date(event.timestamp).toISOString()
        messages.set(data.messageId, {
          id: data.messageId,
          role: data.role,
          content: data.content ?? '',
          timestamp,
          isStreaming: !isUserOrSystem,
          tokenCount: data.tokenCount ?? 0,
          ...extractMessageOptionalFields(data),
        } as unknown as T)
        break
      }
      case 'message.delta': {
        const data = event.data as Extract<TurnEvent, { type: 'message.delta' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) updateMessageDelta(msg, data.content)
        break
      }
      case 'message.thinking': {
        const data = event.data as Extract<TurnEvent, { type: 'message.thinking' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) updateMessageThinking(msg, data.content)
        break
      }
      case 'message.done': {
        const data = event.data as Extract<TurnEvent, { type: 'message.done' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) updateMessageDone(msg, data)
        break
      }
      case 'tool.call': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.call' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          attachToolCallToMessage(msg, data.toolCall)
          removeFromPreparing(msg, data.toolCall.id)
        }
        break
      }
      case 'tool.result': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.result' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          attachToolResultToMessage(msg, data.toolCallId, data.result)
          removeFromPreparing(msg, data.toolCallId)
        }
        break
      }
      case 'tool.preparing': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.preparing' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          const preparing = (msg as T & { preparingToolCalls?: PreparingToolCall[] }).preparingToolCalls ?? []
          const existingIndex = preparing.findIndex((p) => p.index === data.index)
          const entry: PreparingToolCall = {
            index: data.index,
            name: data.name,
            ...(data.arguments ? { arguments: data.arguments } : {}),
          }
          if (existingIndex >= 0) {
            preparing[existingIndex] = entry
          } else {
            preparing.push(entry)
          }
          ;(msg as T & { preparingToolCalls: PreparingToolCall[] }).preparingToolCalls = preparing
        }
        break
      }
      case 'tool.output': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.output' }>['data']
        const msg = findMessageWithToolCall(messages, data.toolCallId)
        if (msg) {
          const tc = (msg as { toolCalls?: ToolCallWithResult[] }).toolCalls?.find((tc) => tc.id === data.toolCallId)
          if (tc) {
            const output = tc.streamingOutput ?? []
            output.push({ stream: data.stream, content: data.content, timestamp: event.timestamp })
            tc.streamingOutput = output
          }
        }
        break
      }
      case 'format.retry': {
        const data = event.data as Extract<TurnEvent, { type: 'format.retry' }>['data']
        for (const msg of messages.values()) {
          const retries = (msg as T & { formatRetries?: FormatRetry[] }).formatRetries ?? []
          retries.push({ attempt: data.attempt, maxAttempts: data.maxAttempts, timestamp: event.timestamp })
          ;(msg as T & { formatRetries: FormatRetry[] }).formatRetries = retries
        }
        break
      }
      case 'chat.done': {
        const data = event.data as Extract<TurnEvent, { type: 'chat.done' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          ;(
            msg as T & { isComplete: boolean; completeReason: 'complete' | 'stopped' | 'error' | 'waiting_for_user' }
          ).isComplete = true
          ;(
            msg as T & { isComplete: boolean; completeReason: 'complete' | 'stopped' | 'error' | 'waiting_for_user' }
          ).completeReason = data.reason
        }
        break
      }
      case 'chat.error': {
        const data = event.data as Extract<TurnEvent, { type: 'chat.error' }>['data']
        for (const msg of messages.values()) {
          if (msg.role === 'assistant' && !('isComplete' in msg)) {
            ;(
              msg as T & {
                isComplete: boolean
                completeReason: 'complete' | 'stopped' | 'error' | 'waiting_for_user'
                stats?: { error?: string }
              }
            ).isComplete = true
            ;(
              msg as T & {
                isComplete: boolean
                completeReason: 'complete' | 'stopped' | 'error' | 'waiting_for_user'
                stats?: { error?: string }
              }
            ).completeReason = 'error'
            ;(
              msg as T & {
                isComplete: boolean
                completeReason: 'complete' | 'stopped' | 'error' | 'waiting_for_user'
                stats?: { error?: string }
              }
            ).stats = { error: data.error }
          }
        }
        break
      }
      case 'session.initialized':
      case 'turn.snapshot':
      case 'phase.changed':
      case 'mode.changed':
      case 'running.changed':
      case 'criteria.set':
      case 'criterion.updated':
      case 'context.state':
      case 'context.compacted':
      case 'file.read':
      case 'todo.updated':
        break
    }
  }

  return Array.from(messages.values())
}

function removeFromPreparing(msg: object & { preparingToolCalls?: PreparingToolCall[] }, _toolCallId: string): void {
  if (
    'preparingToolCalls' in msg &&
    Array.isArray((msg as { preparingToolCalls?: PreparingToolCall[] }).preparingToolCalls)
  ) {
    ;(msg as { preparingToolCalls: PreparingToolCall[] }).preparingToolCalls = []
  }
}

function findMessageWithToolCall(messages: Map<string, object>, toolCallId: string): object | undefined {
  for (const msg of messages.values()) {
    if ('toolCalls' in msg && Array.isArray((msg as { toolCalls?: ToolCall[] }).toolCalls)) {
      if ((msg as { toolCalls: ToolCall[] }).toolCalls.some((tc) => tc.id === toolCallId)) {
        return msg
      }
    }
  }
  return undefined
}

function deepCloneMessage<T extends object>(msg: T): T {
  const cloned = { ...msg } as T & Record<string, unknown>
  const obj = cloned as Record<string, unknown>
  if (obj['toolCalls']) {
    obj['toolCalls'] = (obj['toolCalls'] as ToolCall[]).map((tc) => ({
      ...tc,
      ...(tc.result ? { result: { ...tc.result } } : {}),
    }))
  }
  if (obj['segments']) {
    obj['segments'] = [...(obj['segments'] as unknown[])]
  }
  if (obj['attachments']) {
    obj['attachments'] = [...(obj['attachments'] as unknown[])]
  }
  return cloned as T
}
