import type { Message, Attachment } from '../../shared/types.js'
import type { StoredEvent, TurnEvent, SessionSnapshot, SnapshotMessage } from './types.js'
import { applyEvents } from './apply-events.js'
import stripAnsi from 'strip-ansi'
import type { ContextMessage, ContextMessageBuildOptions, EventLike, MessageWithId } from './fold-types.js'

function cloneMessage(message: Message): Message {
  return {
    ...message,
    ...(message.attachments ? { attachments: [...message.attachments] } : {}),
    ...(message.toolCalls
      ? {
          toolCalls: message.toolCalls.map((toolCall) => ({
            ...toolCall,
            ...(toolCall.streamingOutput ? { streamingOutput: [...toolCall.streamingOutput] } : {}),
            ...(toolCall.result ? { result: { ...toolCall.result } } : {}),
          })),
        }
      : {}),
    ...(message.segments ? { segments: [...message.segments] } : {}),
    ...(message.preparingToolCalls && message.preparingToolCalls.length > 0
      ? { preparingToolCalls: [...message.preparingToolCalls] }
      : {}),
  }
}

export function spreadOptionalMessageFields(message: SnapshotMessage) {
  return {
    ...(message.thinkingContent !== undefined && { thinkingContent: message.thinkingContent }),
    ...(message.toolCalls !== undefined && { toolCalls: message.toolCalls }),
    ...(message.segments !== undefined && { segments: message.segments }),
    ...(message.stats !== undefined && { stats: message.stats }),
    ...(message.tokenCount !== undefined && { tokenCount: message.tokenCount }),
    ...(message.isStreaming !== undefined && { isStreaming: message.isStreaming }),
    ...(message.partial !== undefined && { partial: message.partial }),
    ...(message.subAgentId !== undefined && { subAgentId: message.subAgentId }),
    ...(message.subAgentType !== undefined && { subAgentType: message.subAgentType }),
    ...(message.isSystemGenerated !== undefined && { isSystemGenerated: message.isSystemGenerated }),
    ...(message.messageKind !== undefined && { messageKind: message.messageKind }),
    ...(message.contextWindowId !== undefined && { contextWindowId: message.contextWindowId }),
    ...(message.isCompactionSummary !== undefined && { isCompactionSummary: message.isCompactionSummary }),
    ...(message.attachments !== undefined && { attachments: message.attachments }),
    ...(message.preparingToolCalls !== undefined &&
      message.preparingToolCalls.length > 0 && { preparingToolCalls: message.preparingToolCalls }),
    ...(message.metadata !== undefined && { metadata: message.metadata }),
  }
}

function snapshotMessageToMessage(message: SnapshotMessage): Message {
  return cloneMessage({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: new Date(message.timestamp).toISOString(),
    ...spreadOptionalMessageFields(message),
  })
}

export function shouldIncludeContextMessage(
  message: Pick<SnapshotMessage, 'role' | 'contextWindowId' | 'subAgentType' | 'subAgentId'>,
  windowId?: string,
  options?: ContextMessageBuildOptions,
): boolean {
  const includeVerifier = options?.includeVerifier ?? true
  return (
    message.role !== 'system' &&
    (windowId === undefined || message.contextWindowId === windowId) &&
    (includeVerifier || message.subAgentType !== 'verifier') &&
    !message.subAgentId
  )
}

export function appendSnapshotMessageContext(result: ContextMessage[], message: SnapshotMessage): void {
  const contextMsg: ContextMessage = {
    role: message.role as 'user' | 'assistant',
    content: message.content,
  }
  if (message.thinkingContent) {
    contextMsg.thinkingContent = message.thinkingContent
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    const fulfilledToolCalls = message.toolCalls.filter((tc) => tc.result)
    if (fulfilledToolCalls.length > 0) {
      contextMsg.toolCalls = fulfilledToolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      }))
    }
  }
  if (message.attachments !== undefined) {
    contextMsg.attachments = message.attachments
  }
  result.push(contextMsg)
  if (!message.toolCalls) return
  for (const toolCall of message.toolCalls) {
    if (!toolCall.result) continue
    result.push({
      role: 'tool',
      content: stripAnsi(
        toolCall.result.success
          ? (toolCall.result.output ?? 'Success')
          : toolCall.result.output
            ? `${toolCall.result.output}\n\nError: ${toolCall.result.error}`
            : `Error: ${toolCall.result.error}`,
      ),
      toolCallId: toolCall.id,
    })
  }
}

function applyStoredMessageEvents(initialMessages: Message[], events: StoredEvent[]): Message[] {
  return applyEvents(initialMessages as unknown as Message[], events, { timestampAsNumber: false }) as Message[]
}

export function applyTurnEventsToSnapshotMessages(
  initialMessages: SnapshotMessage[],
  events: EventLike[],
): SnapshotMessage[] {
  const messages = applyEvents(initialMessages as unknown as Message[], events as unknown as StoredEvent[], {
    timestampAsNumber: true,
  }) as unknown as SnapshotMessage[]
  return messages.map((msg) => ({ ...msg, isStreaming: msg.isStreaming ?? true }))
}

export function buildMessagesFromStoredEvents(events: StoredEvent[]): Message[] {
  const snapshotEvent = [...events].reverse().find((event) => event.type === 'turn.snapshot')
  if (snapshotEvent) {
    const snapshot = snapshotEvent.data as SessionSnapshot
    const snapshotMessages = snapshot.messages.map(snapshotMessageToMessage)
    const laterEvents = events.filter((event) => event.seq > snapshotEvent.seq)
    return applyStoredMessageEvents(snapshotMessages, laterEvents)
  }
  return applyStoredMessageEvents([], events)
}

export function buildContextMessagesFromStoredEvents(
  events: StoredEvent[],
  windowId?: string,
  options?: ContextMessageBuildOptions,
): ContextMessage[] {
  const includeVerifier = options?.includeVerifier ?? true
  const messages: Array<ContextMessage & { id: string }> = []
  const messageMap = new Map<string, ContextMessage & { id: string }>()
  const fulfilledToolCallIds = new Set<string>()

  for (const event of events) {
    switch (event.type) {
      case 'message.start': {
        const data = event.data as Extract<TurnEvent, { type: 'message.start' }>['data']
        if (
          data.role !== 'system' &&
          (windowId === undefined || data.contextWindowId === windowId) &&
          (includeVerifier || data.subAgentType !== 'verifier') &&
          !data.subAgentId
        ) {
          const message: ContextMessage & { id: string } = {
            id: data.messageId,
            role: data.role as 'user' | 'assistant',
            content: data.content ?? '',
            ...(data.attachments !== undefined && { attachments: data.attachments }),
          }
          messageMap.set(data.messageId, message)
          messages.push(message)
        }
        break
      }
      case 'message.thinking': {
        handleMessageThinking(messageMap, event.data as Extract<TurnEvent, { type: 'message.thinking' }>['data'])
        break
      }
      case 'message.delta': {
        handleMessageDelta(messageMap, event.data as Extract<TurnEvent, { type: 'message.delta' }>['data'])
        break
      }
      case 'tool.call': {
        handleToolCall(messageMap, event.data as Extract<TurnEvent, { type: 'tool.call' }>['data'])
        break
      }
      case 'tool.result': {
        handleToolResult(
          messages,
          messageMap,
          fulfilledToolCallIds,
          event.data as Extract<TurnEvent, { type: 'tool.result' }>['data'],
        )
        break
      }
    }
  }

  stripOrphanedToolCalls(messages, fulfilledToolCallIds)
  return messages.map(({ id: _id, ...message }) => message)
}

export function handleMessageThinking(
  messageMap: Map<string, MessageWithId>,
  data: { messageId: string; content: string },
): void {
  const msg = messageMap.get(data.messageId)
  if (msg) {
    msg.thinkingContent = (msg.thinkingContent ?? '') + data.content
  }
}

export function handleMessageDelta(
  messageMap: Map<string, MessageWithId>,
  data: { messageId: string; content: string },
): void {
  const msg = messageMap.get(data.messageId)
  if (msg) {
    msg.content += data.content
  }
}

export function handleToolCall(
  messageMap: Map<string, MessageWithId>,
  data: { messageId: string; toolCall: { id: string; name: string; arguments: Record<string, unknown> } },
): void {
  const msg = messageMap.get(data.messageId)
  if (msg) {
    if (!msg.toolCalls) msg.toolCalls = []
    msg.toolCalls.push(data.toolCall)
  }
}

export function handleToolResult(
  messages: MessageWithId[],
  messageMap: Map<string, MessageWithId>,
  fulfilled: Set<string>,
  data: {
    messageId: string
    toolCallId: string
    result: {
      success: boolean
      output?: string
      error?: string
      metadata?: { mimeType?: string; dataUrl?: string; path?: string; size?: number }
    }
  },
): void {
  fulfilled.add(data.toolCallId)
  if (messageMap.has(data.messageId)) {
    const imageMeta = data.result.metadata
    const toolMsg: MessageWithId = {
      id: `tool-${data.toolCallId}`,
      role: 'tool',
      content: stripAnsi(
        data.result.success
          ? (data.result.output ?? 'Success')
          : data.result.output
            ? `${data.result.output}\n\nError: ${data.result.error}`
            : `Error: ${data.result.error}`,
      ),
      toolCallId: data.toolCallId,
    }
    if (imageMeta?.dataUrl && imageMeta?.mimeType?.startsWith('image/')) {
      toolMsg.attachments = [
        {
          id: crypto.randomUUID(),
          filename: imageMeta.path ?? 'image',
          mimeType: imageMeta.mimeType as Attachment['mimeType'],
          size: imageMeta.size ?? 0,
          data: imageMeta.dataUrl,
        },
      ]
    }
    messages.push(toolMsg)
  }
}

export function stripOrphanedToolCalls(messages: MessageWithId[], fulfilledToolCallIds: Set<string>): void {
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      const fulfilled = msg.toolCalls.filter((tc) => fulfilledToolCallIds.has(tc.id))
      if (fulfilled.length === 0) {
        delete msg.toolCalls
      } else {
        msg.toolCalls = fulfilled
      }
    }
  }
}

export function buildContextMessagesFromEventHistory(
  events: StoredEvent[],
  windowId?: string,
  options?: ContextMessageBuildOptions,
): ContextMessage[] {
  const snapshotEvent = [...events].reverse().find((event) => event.type === 'turn.snapshot')
  if (!snapshotEvent) {
    return buildContextMessagesFromStoredEvents(events, windowId, options)
  }
  const snapshot = snapshotEvent.data as SessionSnapshot
  const snapshotMessages = snapshot.messages.reduce<ContextMessage[]>((result, message) => {
    if (!shouldIncludeContextMessage(message, windowId, options)) return result
    appendSnapshotMessageContext(result, message)
    return result
  }, [])
  const laterEvents = events.filter((event) => event.seq > snapshotEvent.seq)
  return [...snapshotMessages, ...buildContextMessagesFromStoredEvents(laterEvents, windowId, options)]
}

export function foldTurnEventsToSnapshotMessages(events: EventLike[]): SnapshotMessage[] {
  return applyTurnEventsToSnapshotMessages([], events)
}

export function foldTurnEventsToSnapshotMessagesFromInitial(
  events: EventLike[],
  initialMessages: SnapshotMessage[],
): SnapshotMessage[] {
  return applyTurnEventsToSnapshotMessages(initialMessages, events)
}

export function getMessagesForWindow(messages: SnapshotMessage[], windowId: string): SnapshotMessage[] {
  return messages.filter((m) => m.contextWindowId === windowId)
}

export function buildContextMessagesFromMessages(messages: SnapshotMessage[], windowId: string): ContextMessage[] {
  return getMessagesForWindow(messages, windowId).reduce<ContextMessage[]>((result, message) => {
    if (!shouldIncludeContextMessage(message, windowId)) return result
    appendSnapshotMessageContext(result, message)
    return result
  }, [])
}
