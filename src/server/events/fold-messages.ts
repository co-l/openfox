import type { Message, Attachment, StatsSource } from '../../shared/types.js'
import type { StoredEvent, TurnEvent, FoldedMessage } from './types.js'
import { applyEvents } from './apply-events.js'
import stripAnsi from 'strip-ansi'
import type { ContextMessage, ContextMessageBuildOptions, EventLike, MessageWithId } from './fold-types.js'

export function spreadOptionalMessageFields(message: FoldedMessage) {
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

function applyStoredMessageEvents(initialMessages: Message[], events: StoredEvent[]): Message[] {
  return applyEvents(initialMessages as unknown as Message[], events, { timestampAsNumber: false }) as Message[]
}

/**
 * Fold events into fully-resolved state messages (the session.state currency).
 */
export function foldTurnEventsToMessages(events: EventLike[]): FoldedMessage[] {
  const messages = applyEvents([], events as unknown as StoredEvent[], {
    timestampAsNumber: true,
  }) as unknown as FoldedMessage[]
  return messages.map((msg) => ({ ...msg, isStreaming: msg.isStreaming ?? true }))
}

/**
 * Extract compact per-response stats (id + timestamp + MessageStats) for the
 * whole session, across every context window, without rebuilding messages.
 * In the v3 tree, `message` nodes carry their merged stats — the node
 * timestamp is the message START time (the buffer's start), matching the
 * v1 snapshot/stats semantics exactly.
 */
export function buildSessionStatsMessages(events: StoredEvent[]): StatsSource[] {
  const statsById = new Map<string, StatsSource>()
  for (const event of events) {
    if (event.type !== 'message') continue
    const data = event.data as Extract<TurnEvent, { type: 'message' }>['data']
    if (data.stats) {
      statsById.set(data.messageId, {
        id: data.messageId,
        timestamp: new Date(event.timestamp).toISOString(),
        stats: data.stats,
      })
    }
  }
  return Array.from(statsById.values())
}

export function buildMessagesFromStoredEvents(
  events: StoredEvent[],
  maxVisibleItems?: number,
): { messages: Message[]; hiddenCount: number } {
  // hiddenCount counts "user-facing messages" (distinct message ids),
  // not all rendered items. This is intentional: tool results and other
  // expanded items are treated as belonging to their parent message, so
  // truncation that removes a message also removes its children without
  // inflating the hidden count.
  const messages = applyStoredMessageEvents([], events)
  if (maxVisibleItems !== undefined && maxVisibleItems > 0 && messages.length > maxVisibleItems) {
    return { messages: messages.slice(-maxVisibleItems), hiddenCount: messages.length - maxVisibleItems }
  }
  return { messages, hiddenCount: 0 }
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
      // Merged message (v3 tree persistence unit). Produces the exact
      // ContextMessage the v1 chunk sequence (start + thinking + deltas +
      // tool.calls) folded to: same filters, same fields, tool calls without
      // results (results arrive as separate tool.result events). This is what
      // keeps single-chain requests byte-identical to the v1 encoding.
      case 'message':
      case 'message.start': {
        const data = event.data as Extract<TurnEvent, { type: 'message' }>['data']
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
            ...(data.thinkingContent ? { thinkingContent: data.thinkingContent } : {}),
            ...(data.toolCalls && data.toolCalls.length > 0
              ? { toolCalls: data.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })) }
              : {}),
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
  reorderToolMessages(messages)
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
      const description = (imageMeta as Record<string, unknown>)['description']
      toolMsg.attachments = [
        {
          id: crypto.randomUUID(),
          filename: imageMeta.path ?? 'image',
          mimeType: imageMeta.mimeType as Attachment['mimeType'],
          size: imageMeta.size ?? 0,
          data: imageMeta.dataUrl,
          ...(typeof description === 'string' ? { description } : {}),
        },
      ]
    }
    // Insert tool message right after its parent assistant message,
    // before any interleaved user messages (e.g. system-reminder injected
    // during tool execution). This ensures stable ordering regardless of
    // whether the context is assembled from raw events or a snapshot.
    const parentIdx = messages.findIndex((m) => m.id === data.messageId)
    if (parentIdx >= 0) {
      let insertIdx = parentIdx + 1
      while (insertIdx < messages.length && messages[insertIdx]!.role === 'tool' && messages[insertIdx]!.toolCallId) {
        insertIdx++
      }
      messages.splice(insertIdx, 0, toolMsg)
    } else {
      messages.push(toolMsg)
    }
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

/**
 * Reorder tool messages to match the tool call order of their parent assistant message.
 *
 * When parallel tool calls are executed, tool.result events may arrive in any order
 * (completion order). This function ensures tool messages appear in the same order
 * as the tool calls in the assistant's toolCalls array, preserving LLM cache stability.
 */
export function reorderToolMessages(messages: MessageWithId[]): void {
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]!
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 1) {
      // Build index map: toolCallId → position in toolCalls array
      const orderMap = new Map<string, number>()
      msg.toolCalls.forEach((tc, idx) => orderMap.set(tc.id, idx))

      // Collect tool messages that belong to this assistant
      const toolStart = i + 1
      let toolEnd = toolStart
      while (toolEnd < messages.length && messages[toolEnd]!.role === 'tool') {
        toolEnd++
      }

      if (toolEnd - toolStart > 1) {
        const toolSlice = messages.slice(toolStart, toolEnd)
        // Skip reordering if any tool message's toolCallId is not found in the parent's toolCalls
        const allKnown = toolSlice.every((m) => m.toolCallId && orderMap.has(m.toolCallId))
        if (allKnown) {
          toolSlice.sort((a, b) => {
            const aOrder = orderMap.get(a.toolCallId!)!
            const bOrder = orderMap.get(b.toolCallId!)!
            return aOrder - bOrder
          })
          for (let j = 0; j < toolSlice.length; j++) {
            messages[toolStart + j] = toolSlice[j]!
          }
        }
      }

      i = toolEnd
    } else {
      i++
    }
  }
}

/**
 * Canonical entry point for LLM context building: fold the event history
 * (the session's active path) into ContextMessage[].
 */
export function buildContextMessagesFromEventHistory(
  events: StoredEvent[],
  windowId?: string,
  options?: ContextMessageBuildOptions,
): ContextMessage[] {
  return buildContextMessagesFromStoredEvents(events, windowId, options)
}
