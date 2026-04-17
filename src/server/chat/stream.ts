/**
 * Core LLM streaming function - the ONE place all LLM interactions go through.
 * 
 * Every LLM call:
 * - Uses the current conversation as context
 * - Creates a visible assistant message
 * - Streams response with deltas
 * - Handles XML tool format retry universally
 */

import type { ToolCall, MessageSegment, Attachment } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { StreamTiming } from '../llm/streaming.js'
import type { SessionManager } from '../session/index.js'
import { streamWithSegments } from '../llm/streaming.js'
import { estimateContextSize } from '../context/tokenizer.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { logger } from '../utils/logger.js'
import {
  createChatDeltaMessage,
  createChatThinkingMessage,
  createChatToolPreparingMessage,
  createChatDoneMessage,
  createChatErrorMessage,
  createChatMessageMessage,
  createChatProgressMessage,
} from '../ws/protocol.js'
import { FORMAT_CORRECTION_PROMPT, MAX_FORMAT_RETRIES } from './prompts.js'

export interface StreamOptions {
  sessionManager: SessionManager
  sessionId: string
  systemPrompt: string
  llmClient: LLMClientWithModel
  tools?: LLMToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required'
  signal?: AbortSignal | undefined
  onEvent: (event: ServerMessage) => void
  /** Optional: provide custom messages instead of using session's current window */
  customMessages?: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; toolCalls?: ToolCall[]; toolCallId?: string }>
  /** Optional: sub-agent ID to tag the created assistant message */
  subAgentId?: string
  /** Optional: sub-agent type to tag the created assistant message */
  subAgentType?: string
  /** Optional: disable thinking/reasoning for this call (default: false) */
  disableThinking?: boolean
  /** Optional: reuse an existing message ID instead of creating a new one */
  existingMessageId?: string
  /** Optional: callback when vision fallback starts describing an image */
  onVisionFallbackStart?: (attachmentId: string, filename?: string) => void
  /** Optional: callback when vision fallback completes describing an image */
  onVisionFallbackDone?: (attachmentId: string, description: string) => void
}

export interface StreamResult {
  messageId: string
  content: string
  thinkingContent?: string
  toolCalls: ToolCall[]
  segments: MessageSegment[]
  usage: { promptTokens: number; completionTokens: number }
  timing: StreamTiming
}

/**
 * Stream an LLM response, creating a visible assistant message.
 * Handles XML tool format retry automatically.
 * 
 * @returns The result including messageId, content, tool calls, and usage stats
 */
export async function streamLLMResponse(options: StreamOptions): Promise<StreamResult> {
  return streamLLMResponseInternal(options, 0)
}

async function streamLLMResponseInternal(
  options: StreamOptions,
  formatRetryCount: number,
  existingMessageId?: string
): Promise<StreamResult> {
  const { sessionManager, sessionId, systemPrompt, llmClient, tools, toolChoice, signal, onEvent, customMessages, subAgentId, subAgentType, disableThinking, onVisionFallbackStart, onVisionFallbackDone } = options

  // If retrying due to XML format error, inject correction prompt
  if (formatRetryCount > 0) {
    sessionManager.addMessage(sessionId, {
      role: 'user',
      content: FORMAT_CORRECTION_PROMPT,
      isSystemGenerated: true,
      messageKind: 'correction',
      ...(subAgentId && { subAgentId }),
      ...(subAgentType && { subAgentType }),
    })
  }

  // Build messages - use custom messages if provided, otherwise session's current window
  let llmMessages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCalls?: ToolCall[]; toolCallId?: string; attachments?: Attachment[] }>
  
  if (customMessages) {
    llmMessages = [
      { role: 'system', content: systemPrompt },
      ...customMessages,
    ]
  } else {
    const currentWindowMessages = sessionManager.getCurrentWindowMessages(sessionId)
    llmMessages = [
      { role: 'system', content: systemPrompt },
      ...currentWindowMessages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'tool',
        content: m.content,
        ...(m.toolCalls && { toolCalls: m.toolCalls }),
        ...(m.toolCallId && { toolCallId: m.toolCallId }),
        ...(m.attachments && { attachments: m.attachments }),
      })),
    ]
  }

  // Pre-flight estimation: warn user if context is approaching limit
  const config = getRuntimeConfig()
  const estimate = estimateContextSize(
    systemPrompt,
    llmMessages.map(m => ({ role: m.role, content: m.content })),
    config.context.maxTokens
  )
  
  if (estimate.isOverLimit) {
    logger.warn('Context exceeds limit', { 
      sessionId, 
      estimated: estimate.estimatedTokens, 
      max: estimate.maxTokens,
      percent: estimate.percentUsed 
    })
    onEvent(createChatProgressMessage(
      `Context is full (~${estimate.percentUsed}%). Please compact before continuing.`,
      'context_error'
    ))
    // Don't throw - let the LLM truncate or error naturally
    // The real promptTokens will be reported after the call
  } else if (estimate.isNearLimit) {
    logger.info('Context nearing limit', { 
      sessionId, 
      estimated: estimate.estimatedTokens, 
      max: estimate.maxTokens,
      percent: estimate.percentUsed 
    })
    onEvent(createChatProgressMessage(
      `Context at ~${estimate.percentUsed}%. Consider compacting soon.`,
      'context_warning'
    ))
  }

  // Create or reuse assistant message
  let messageId = existingMessageId
  if (!messageId) {
    const assistantMsg = sessionManager.addAssistantMessage(sessionId, {
      content: '',
      isStreaming: true,
      ...(subAgentId && { subAgentId }),
      ...(subAgentType && { subAgentType }),
    })
    messageId = assistantMsg.id
    onEvent(createChatMessageMessage(assistantMsg))
  }

  // Stream response
  const streamRequest: {
    messages: typeof llmMessages
    tools?: typeof tools
    toolChoice?: 'auto' | 'none' | 'required'
    disableThinking: boolean
    signal?: AbortSignal
    onVisionFallbackStart?: (attachmentId: string, filename?: string) => void
    onVisionFallbackDone?: (attachmentId: string, description: string) => void
  } = {
    messages: llmMessages,
    ...(tools && { tools }),
    ...(tools && { toolChoice: toolChoice ?? 'auto' }),
    disableThinking: disableThinking ?? false,
    ...(signal && { signal }),
  }
  if (onVisionFallbackStart) streamRequest.onVisionFallbackStart = onVisionFallbackStart
  if (onVisionFallbackDone) streamRequest.onVisionFallbackDone = onVisionFallbackDone

  const stream = streamWithSegments(llmClient, streamRequest)

  let result: Awaited<ReturnType<typeof stream.next>>['value'] = null
  
  // Track tool call indices we've emitted preparing events for
  const seenToolIndices = new Set<number>()
  // Track accumulated tool names by index (for when name comes in multiple chunks)
  const toolNames = new Map<number, string>()

  while (true) {
    if (signal?.aborted) {
      sessionManager.updateMessage(sessionId, messageId, { isStreaming: false, partial: true })
      // Don't emit chat.done here - let callers emit it with partial stats
      throw new Error('Aborted')
    }

    const { value, done } = await stream.next()

    if (done) {
      result = value
      break
    }

    // Forward streaming events
    switch (value.type) {
      case 'text_delta':
        onEvent(createChatDeltaMessage(messageId, value.content))
        break
      case 'thinking_delta':
        onEvent(createChatThinkingMessage(messageId, value.content))
        break
      case 'tool_call_delta': {
        // Accumulate tool name if provided
        if (value.name) {
          const existingName = toolNames.get(value.index) ?? ''
          toolNames.set(value.index, existingName + value.name)
        }
        
        // Emit preparing event on first delta for this index (when we have a complete name)
        const fullName = toolNames.get(value.index)
        if (!seenToolIndices.has(value.index) && fullName) {
          seenToolIndices.add(value.index)
          onEvent(createChatToolPreparingMessage(messageId, value.index, fullName))
        }
        break
      }
      case 'xml_tool_abort': {
        // Model used XML tool format - retry with same message
        const newRetryCount = formatRetryCount + 1
        if (newRetryCount <= MAX_FORMAT_RETRIES) {
          logger.warn('XML tool format detected, retrying', {
            sessionId,
            attempt: newRetryCount,
          })
          return streamLLMResponseInternal(options, newRetryCount, messageId)
        } else {
          sessionManager.updateMessage(sessionId, messageId, { isStreaming: false })
          onEvent(createChatErrorMessage('Model repeatedly used XML tool format after 10 retries', false))
          onEvent(createChatDoneMessage(messageId, 'error'))
          throw new Error('XML tool format retry limit exceeded')
        }
      }
      case 'error':
        onEvent(createChatErrorMessage(value.error, true))
        break
    }
  }

  if (!result) {
    sessionManager.updateMessage(sessionId, messageId, { isStreaming: false })
    onEvent(createChatDoneMessage(messageId, 'error'))
    throw new Error('LLM stream returned no result')
  }

  const { content, thinkingContent, toolCalls, response, segments, timing } = result

  // Update context size from real token count
  sessionManager.setCurrentContextSize(sessionId, response.usage.promptTokens)
  sessionManager.addTokensUsed(sessionId, response.usage.promptTokens + response.usage.completionTokens)

  // Update assistant message with final content (stats attached by caller at end of turn)
  sessionManager.updateMessage(sessionId, messageId, {
    content,
    ...(thinkingContent && { thinkingContent }),
    ...(toolCalls.length > 0 && { toolCalls }),
    segments,
    isStreaming: false,
  })

  return {
    messageId,
    content,
    thinkingContent,
    toolCalls,
    segments,
    usage: {
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
    },
    timing,
  }
}
