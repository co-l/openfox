import type { Message, Criterion, ExecutionState } from '../../shared/types.js'
import type { StoredEvent, TurnEvent, SessionSnapshot, SnapshotMessage, ToolCallWithResult } from './types.js'

export interface ContextMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  toolCallId?: string
}

interface SnapshotSessionState {
  mode: SessionSnapshot['mode']
  phase: SessionSnapshot['phase']
  isRunning: boolean
  criteria: Criterion[]
  executionState?: Pick<ExecutionState, 'currentTokenCount' | 'compactionCount'> | null
}

type EventLike = Pick<StoredEvent, 'type' | 'data'> & Partial<Pick<StoredEvent, 'timestamp'>>

export function buildMessagesFromStoredEvents(events: StoredEvent[]): Message[] {
  const messages = new Map<string, Message>()

  for (const event of events) {
    switch (event.type) {
      case 'message.start': {
        const data = event.data as Extract<TurnEvent, { type: 'message.start' }>['data']
        const isUserOrSystem = data.role === 'user' || data.role === 'system'
        messages.set(data.messageId, {
          id: data.messageId,
          role: data.role,
          content: data.content ?? '',
          timestamp: new Date(event.timestamp).toISOString(),
          tokenCount: 0,
          isStreaming: !isUserOrSystem,
          ...(data.contextWindowId ? { contextWindowId: data.contextWindowId } : {}),
          ...(data.subAgentId ? { subAgentId: data.subAgentId } : {}),
          ...(data.subAgentType ? { subAgentType: data.subAgentType } : {}),
          ...(data.isSystemGenerated ? { isSystemGenerated: data.isSystemGenerated } : {}),
          ...(data.messageKind ? { messageKind: data.messageKind } : {}),
        })
        break
      }
      case 'message.delta': {
        const data = event.data as Extract<TurnEvent, { type: 'message.delta' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.content += data.content
        }
        break
      }
      case 'message.thinking': {
        const data = event.data as Extract<TurnEvent, { type: 'message.thinking' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.thinkingContent = (msg.thinkingContent ?? '') + data.content
        }
        break
      }
      case 'message.done': {
        const data = event.data as Extract<TurnEvent, { type: 'message.done' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.isStreaming = false
          if (data.stats) msg.stats = data.stats
          if (data.segments) msg.segments = data.segments
          if (data.partial) msg.partial = data.partial
        }
        break
      }
      case 'tool.call': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.call' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = []
          msg.toolCalls.push(data.toolCall)
        }
        break
      }
      case 'tool.result': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.result' }>['data']
        const msg = messages.get(data.messageId)
        if (msg?.toolCalls) {
          const toolCall = msg.toolCalls.find((tc) => tc.id === data.toolCallId)
          if (toolCall) {
            toolCall.result = data.result
          }
        }
        break
      }
      case 'turn.snapshot':
      case 'phase.changed':
      case 'mode.changed':
      case 'running.changed':
      case 'criteria.set':
      case 'criterion.updated':
      case 'context.state':
      case 'context.compacted':
      case 'todo.updated':
      case 'chat.done':
      case 'chat.error':
      case 'format.retry':
      case 'tool.preparing':
      case 'tool.output':
        break
    }
  }

  return Array.from(messages.values())
}

export function buildContextMessagesFromStoredEvents(events: StoredEvent[]): ContextMessage[] {
  const messages: Array<ContextMessage & { id: string }> = []
  const messageMap = new Map<string, ContextMessage & { id: string }>()

  for (const event of events) {
    switch (event.type) {
      case 'message.start': {
        const data = event.data as Extract<TurnEvent, { type: 'message.start' }>['data']
        if (data.role !== 'system') {
          const message = {
            id: data.messageId,
            role: data.role as 'user' | 'assistant',
            content: data.content ?? '',
          }
          messageMap.set(data.messageId, message)
          messages.push(message)
        }
        break
      }
      case 'message.delta': {
        const data = event.data as Extract<TurnEvent, { type: 'message.delta' }>['data']
        const msg = messageMap.get(data.messageId)
        if (msg) {
          msg.content += data.content
        }
        break
      }
      case 'tool.call': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.call' }>['data']
        const msg = messageMap.get(data.messageId)
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = []
          msg.toolCalls.push(data.toolCall)
        }
        break
      }
      case 'tool.result': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.result' }>['data']
        messages.push({
          id: `tool-${data.toolCallId}`,
          role: 'tool',
          content: data.result.success ? (data.result.output ?? 'Success') : `Error: ${data.result.error}`,
          toolCallId: data.toolCallId,
        })
        break
      }
    }
  }

  return messages.map(({ id: _id, ...message }) => message)
}

export function foldTurnEventsToSnapshotMessages(events: EventLike[]): SnapshotMessage[] {
  const messages = new Map<string, SnapshotMessage>()

  for (const event of events) {
    switch (event.type) {
      case 'message.start': {
        const data = event.data as Extract<TurnEvent, { type: 'message.start' }>['data']
        messages.set(data.messageId, {
          id: data.messageId,
          role: data.role,
          content: data.content ?? '',
          timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
          isStreaming: true,
          ...(data.contextWindowId ? { contextWindowId: data.contextWindowId } : {}),
          ...(data.subAgentId ? { subAgentId: data.subAgentId } : {}),
          ...(data.subAgentType ? { subAgentType: data.subAgentType } : {}),
          ...(data.isSystemGenerated ? { isSystemGenerated: data.isSystemGenerated } : {}),
          ...(data.messageKind ? { messageKind: data.messageKind } : {}),
        })
        break
      }
      case 'message.delta': {
        const data = event.data as Extract<TurnEvent, { type: 'message.delta' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.content += data.content
        }
        break
      }
      case 'message.thinking': {
        const data = event.data as Extract<TurnEvent, { type: 'message.thinking' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.thinkingContent = (msg.thinkingContent ?? '') + data.content
        }
        break
      }
      case 'message.done': {
        const data = event.data as Extract<TurnEvent, { type: 'message.done' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.isStreaming = false
          if (data.stats) msg.stats = data.stats
          if (data.segments) msg.segments = data.segments
          if (data.partial) msg.partial = data.partial
        }
        break
      }
      case 'tool.call': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.call' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = []
          msg.toolCalls.push(data.toolCall as ToolCallWithResult)
        }
        break
      }
      case 'tool.result': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.result' }>['data']
        const msg = messages.get(data.messageId)
        if (msg?.toolCalls) {
          const toolCall = msg.toolCalls.find((tc) => tc.id === data.toolCallId)
          if (toolCall) {
            toolCall.result = data.result
          }
        }
        break
      }
    }
  }

  return Array.from(messages.values())
}

export function buildSnapshotFromSessionState(input: {
  session: SnapshotSessionState
  events: EventLike[]
  latestSeq: number
  snapshotAt?: number
}): SessionSnapshot {
  const { session, events, latestSeq, snapshotAt = Date.now() } = input

  return {
    mode: session.mode,
    phase: session.phase,
    isRunning: session.isRunning,
    messages: foldTurnEventsToSnapshotMessages(events),
    criteria: session.criteria,
    contextState: {
      currentTokens: session.executionState?.currentTokenCount ?? 0,
      maxTokens: 200000,
      compactionCount: session.executionState?.compactionCount ?? 0,
      dangerZone: false,
      canCompact: false,
    },
    todos: [],
    snapshotSeq: latestSeq,
    snapshotAt,
  }
}
