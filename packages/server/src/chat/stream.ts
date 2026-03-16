/**
 * Core LLM streaming function - the ONE place all LLM interactions go through.
 * 
 * Every LLM call:
 * - Uses the current conversation as context
 * - Creates a visible assistant message
 * - Streams response with deltas
 * - Handles XML tool format retry universally
 */

import type { ToolCall, MessageSegment } from '@openfox/shared'
import type { ServerMessage } from '@openfox/shared/protocol'
import type { LLMClientWithModel } from '../llm/client.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { StreamTiming } from '../llm/streaming.js'
import { sessionManager } from '../session/index.js'
import { streamWithSegments } from '../llm/streaming.js'
import { estimateTokens } from '../context/tokenizer.js'
import { logger } from '../utils/logger.js'
import {
  createChatDeltaMessage,
  createChatThinkingMessage,
  createChatToolPreparingMessage,
  createChatDoneMessage,
  createChatErrorMessage,
  createChatFormatRetryMessage,
  createChatMessageMessage,
} from '../ws/protocol.js'

// Constants for XML tool format retry
const MAX_FORMAT_RETRIES = 10
const FORMAT_CORRECTION_PROMPT = `IMPORTANT: You MUST use the JSON function calling API. Do NOT output XML tags like <tool_call>, <function=>, or <parameter=>. Your previous attempt was stopped because you used the wrong format. Use the proper tool_calls format.`

export interface StreamOptions {
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
  subAgentType?: 'verifier'
  /** Optional: disable thinking/reasoning for this call (default: true) */
  enableThinking?: boolean
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
  const { sessionId, systemPrompt, llmClient, tools, toolChoice, signal, onEvent, customMessages, subAgentId, subAgentType, enableThinking } = options

  // If retrying due to XML format error, inject correction prompt
  if (formatRetryCount > 0) {
    const correctionMsg = sessionManager.addMessage(sessionId, {
      role: 'user',
      content: FORMAT_CORRECTION_PROMPT,
      tokenCount: estimateTokens(FORMAT_CORRECTION_PROMPT),
      isSystemGenerated: true,
      messageKind: 'correction',
      ...(subAgentId && { subAgentId }),
      ...(subAgentType && { subAgentType }),
    })
    onEvent(createChatMessageMessage(correctionMsg))
    onEvent(createChatFormatRetryMessage(formatRetryCount, MAX_FORMAT_RETRIES))
  }

  // Build messages - use custom messages if provided, otherwise session's current window
  let llmMessages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCalls?: ToolCall[]; toolCallId?: string }>
  
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
      })),
    ]
  }

  // Create or reuse assistant message
  let messageId = existingMessageId
  if (!messageId) {
    const assistantMsg = sessionManager.addMessage(sessionId, {
      role: 'assistant',
      content: '',
      tokenCount: 0,
      isStreaming: true,
      ...(subAgentId && { subAgentId }),
      ...(subAgentType && { subAgentType }),
    })
    messageId = assistantMsg.id
    onEvent(createChatMessageMessage(assistantMsg))
  }

  // Stream response
  const stream = streamWithSegments(llmClient, {
    messages: llmMessages,
    ...(tools && { tools }),
    ...(tools && { toolChoice: toolChoice ?? 'auto' }),
    ...(enableThinking === false && { enableThinking: false }),
  })

  let result: Awaited<ReturnType<typeof stream.next>>['value'] = null
  
  // Track tool call indices we've emitted preparing events for
  const seenToolIndices = new Set<number>()
  // Track accumulated tool names by index (for when name comes in multiple chunks)
  const toolNames = new Map<number, string>()

  while (true) {
    if (signal?.aborted) {
      sessionManager.updateMessage(sessionId, messageId, { isStreaming: false, partial: true })
      onEvent(createChatDoneMessage(messageId, 'stopped'))
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
    tokenCount: response.usage.completionTokens,
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
