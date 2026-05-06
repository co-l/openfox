/**
 * Conversation History - Unified Message Building for LLM Context
 *
 * ONE source of truth: the event store.
 * ONE method to build context: buildContextMessages(events, scope)
 * ONE method to get messages: getConversationMessages(scope)
 *
 * All LLM calls (top-level agent, sub-agent, compaction) use these
 * functions to build their conversation context. No in-memory arrays,
 * no duplicate conversion functions.
 */

import type { StoredEvent, TurnEvent } from '../events/types.js'
import type { ContextMessage } from '../events/folding.js'
import {
  handleMessageThinking,
  handleMessageDelta,
  handleToolCall,
  handleToolResult,
  stripOrphanedToolCalls,
  type MessageWithId,
} from '../events/folding.js'
import type { RequestContextMessage } from './request-context.js'
import { minimalMessagesToRequestContextMessages } from './request-context.js'
import { buildContextMessagesFromEventHistory, foldContextState } from '../events/folding.js'
import { getEventStore } from '../events/index.js'
import type { Attachment } from '../../shared/types.js'

// ============================================================================
// Types
// ============================================================================

export type TopLevelScope = {
  type: 'toplevel'
  sessionId: string
  includeVerifier?: boolean
}

export type SubAgentScope = {
  type: 'subagent'
  sessionId: string
  subAgentId: string
  subAgentType: string
}

export type ConversationScope = TopLevelScope | SubAgentScope

// ============================================================================
// Context Message Building (scope-aware, unified)
// ============================================================================

interface InternalMessage extends MessageWithId {
  subAgentId?: string
  subAgentType?: string
  contextWindowId?: string
  isCompactionSummary?: boolean
}

/**
 * Build context messages for LLM from stored events, scope-aware.
 *
 * For toplevel scope: filters by current context window, excludes sub-agent messages.
 * For subagent scope: filters by subAgentId, handles compaction boundaries.
 */
export function buildContextMessages(events: StoredEvent[], scope: ConversationScope): ContextMessage[] {
  if (scope.type === 'toplevel') {
    return buildTopLevelContextMessages(events, scope)
  }
  return buildSubAgentContextMessages(events, scope)
}

// ============================================================================
// Top-Level Scope
// ============================================================================

function buildTopLevelContextMessages(events: StoredEvent[], scope: TopLevelScope): ContextMessage[] {
  const includeVerifier = scope.includeVerifier ?? true
  const currentWindowId = foldContextState(events, '').currentContextWindowId
  if (!currentWindowId) return []

  return buildContextMessagesFromEventHistory(events, currentWindowId, { includeVerifier })
}

// ============================================================================
// Sub-Agent Scope
// ============================================================================

function buildSubAgentContextMessages(events: StoredEvent[], scope: SubAgentScope): ContextMessage[] {
  const { subAgentId } = scope
  const messages: InternalMessage[] = []
  const messageMap = new Map<string, InternalMessage>()
  const fulfilledToolCallIds = new Set<string>()

  // Find the most recent sub-agent compaction boundary
  let compactionSummaryIndex = -1
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.type === 'context.compacted') {
      const data = event.data as Extract<TurnEvent, { type: 'context.compacted' }>['data']
      if (data.subAgentId === subAgentId) {
        compactionSummaryIndex = i
        break
      }
    }
  }

  const startIdx = compactionSummaryIndex >= 0 ? compactionSummaryIndex : 0

  for (let i = startIdx; i < events.length; i++) {
    const event = events[i]!
    switch (event.type) {
      case 'message.start': {
        const data = event.data as Extract<TurnEvent, { type: 'message.start' }>['data']
        // Only include messages belonging to this sub-agent
        if (data.subAgentId !== subAgentId) break
        if (data.role === 'system') break
        // Exclude context-reset markers — they are UI-only, not useful for LLM context
        if (data.messageKind === 'context-reset') break

        const message: InternalMessage = {
          id: data.messageId,
          role: data.role as 'user' | 'assistant',
          content: data.content ?? '',
          ...(data.subAgentId ? { subAgentId: data.subAgentId } : {}),
          ...(data.subAgentType ? { subAgentType: data.subAgentType } : {}),
          ...(data.contextWindowId ? { contextWindowId: data.contextWindowId } : {}),
          ...(data.isCompactionSummary ? { isCompactionSummary: data.isCompactionSummary } : {}),
          ...(data.attachments !== undefined ? { attachments: data.attachments as Attachment[] } : {}),
        }
        messageMap.set(data.messageId, message)
        messages.push(message)
        break
      }
      case 'message.thinking': {
        const evt = event.data as Extract<TurnEvent, { type: 'message.thinking' }>['data']
        handleMessageThinking(messageMap, evt)
        break
      }
      case 'message.delta': {
        const evt = event.data as Extract<TurnEvent, { type: 'message.delta' }>['data']
        handleMessageDelta(messageMap, evt)
        break
      }
      case 'tool.call': {
        const evt = event.data as Extract<TurnEvent, { type: 'tool.call' }>['data']
        handleToolCall(messageMap, evt)
        break
      }
      case 'tool.result': {
        const evt = event.data as Extract<TurnEvent, { type: 'tool.result' }>['data']
        handleToolResult(messages, messageMap, fulfilledToolCallIds, evt)
        break
      }
      case 'context.compacted': {
        const data = event.data as Extract<TurnEvent, { type: 'context.compacted' }>['data']
        if (data.subAgentId === subAgentId && i === compactionSummaryIndex) {
          // The summary message follows this event; we include it as a user message
          // It will be picked up by message.start events with isCompactionSummary
        }
        break
      }
    }
  }

  stripOrphanedToolCalls(messages, fulfilledToolCallIds)

  return messages.map(
    ({ id: _id, subAgentId: _sa, subAgentType: _st, contextWindowId: _cw, isCompactionSummary: _ics, ...rest }) => {
      const ctx: ContextMessage = {
        role: rest.role as 'user' | 'assistant',
        content: rest.content,
        ...(rest.thinkingContent ? { thinkingContent: rest.thinkingContent } : {}),
        ...(rest.toolCalls ? { toolCalls: rest.toolCalls } : {}),
        ...(rest.toolCallId ? { toolCallId: rest.toolCallId } : {}),
        ...(rest.attachments ? { attachments: rest.attachments } : {}),
      }
      return ctx
    },
  )
}

// ============================================================================
// Convenience: Get Conversation Messages as RequestContextMessage[]
// ============================================================================

/**
 * Get conversation messages for LLM context building.
 * Reads from the event store and returns RequestContextMessage[] ready
 * for assembly into an LLM request.
 *
 * This is THE function to call whenever you need conversation history
 * for any LLM call - top-level agent, sub-agent, or compaction.
 */
export function getConversationMessages(scope: ConversationScope): RequestContextMessage[] {
  const eventStore = getEventStore()
  const events = eventStore.getEvents(scope.sessionId)
  if (events.length === 0) return []

  const contextMessages = buildContextMessages(events, scope)
  return minimalMessagesToRequestContextMessages(contextMessages, 'history')
}
