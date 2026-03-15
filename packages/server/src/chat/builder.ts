/**
 * Builder Worker
 * 
 * Executes ONE builder step: LLM call + tool execution.
 * Does not loop - the orchestrator handles looping.
 */

import type { ToolCall } from '@openfox/shared'
import type { ServerMessage } from '@openfox/shared/protocol'
import type { LLMClientWithModel } from '../llm/client.js'
import type { StepResult } from '../runner/types.js'
import { sessionManager } from '../session/index.js'
import { getToolRegistryForMode } from '../tools/index.js'
import { buildBuilderPrompt, BUILDER_KICKOFF_PROMPT } from './prompts.js'
import { streamLLMResponse } from './stream.js'
import { computeMessageStats } from './stats.js'
import { estimateTokens } from '../context/tokenizer.js'
import {
  createChatToolCallMessage,
  createChatToolResultMessage,
  createChatMessageMessage,
  createChatDoneMessage,
  createCriteriaUpdatedMessage,
} from '../ws/protocol.js'

export interface BuilderStepOptions {
  sessionId: string
  llmClient: LLMClientWithModel
  signal?: AbortSignal
  onMessage: (msg: ServerMessage) => void
}

/**
 * Execute one builder step: LLM call + tool execution.
 * Returns information about what happened.
 */
export async function runBuilderStep(options: BuilderStepOptions): Promise<StepResult> {
  const { sessionId, llmClient, signal, onMessage } = options
  const startTime = performance.now()
  
  let session = sessionManager.requireSession(sessionId)
  
  // Add kickoff prompt on first entry if not already present
  const hasBuilderKickoff = session.messages.some(m => 
    m.isSystemGenerated && m.messageKind === 'auto-prompt' && 
    m.content.includes('fulfil the') && m.content.includes('criteria')
  )
  
  if (!hasBuilderKickoff) {
    const kickoffContent = BUILDER_KICKOFF_PROMPT(session.criteria.length)
    const kickoffMsg = sessionManager.addMessage(sessionId, {
      role: 'user',
      content: kickoffContent,
      tokenCount: estimateTokens(kickoffContent),
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
    })
    onMessage(createChatMessageMessage(kickoffMsg))
    session = sessionManager.requireSession(sessionId)
  }
  
  const toolRegistry = getToolRegistryForMode('builder')
  const systemPrompt = buildBuilderPrompt(
    session.criteria,
    toolRegistry.definitions,
    session.executionState?.modifiedFiles ?? []
  )
  
  // Stream LLM response
  let result
  try {
    result = await streamLLMResponse({
      sessionId,
      systemPrompt,
      llmClient,
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
      signal,
      onEvent: onMessage,
    })
  } catch (error) {
    // Aborted or error - rethrow for orchestrator to handle
    throw error
  }
  
  let totalToolTime = 0
  
  // Execute tool calls
  if (result.toolCalls.length > 0) {
    for (const toolCall of result.toolCalls) {
      if (signal?.aborted) {
        onMessage(createChatDoneMessage(result.messageId, 'stopped'))
        throw new Error('Aborted')
      }
      
      onMessage(createChatToolCallMessage(result.messageId, toolCall.id, toolCall.name, toolCall.arguments))
      
      const toolResult = await toolRegistry.execute(
        toolCall.name,
        toolCall.arguments,
        { workdir: session.workdir, sessionId }
      )
      
      totalToolTime += toolResult.durationMs
      
      onMessage(createChatToolResultMessage(result.messageId, toolCall.id, toolCall.name, toolResult))
      
      // Save tool result as separate message for LLM context
      const toolMsg = sessionManager.addMessage(sessionId, {
        role: 'tool',
        content: toolResult.success ? (toolResult.output ?? 'Success') : `Error: ${toolResult.error}`,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        toolResult,
        tokenCount: estimateTokens(toolResult.output ?? toolResult.error ?? ''),
      })
      onMessage(createChatMessageMessage(toolMsg))
      
      // Track modified files
      if (toolResult.success && ['write_file', 'edit_file'].includes(toolCall.name)) {
        const path = toolCall.arguments['path'] as string
        sessionManager.addModifiedFile(sessionId, path)
      }
      
      // Check if criteria changed
      const updatedSession = sessionManager.requireSession(sessionId)
      if (JSON.stringify(updatedSession.criteria) !== JSON.stringify(session.criteria)) {
        onMessage(createCriteriaUpdatedMessage(updatedSession.criteria))
        session = updatedSession
      }
    }
  }
  
  // Build and send final stats (updates initial stats from streamLLMResponse with tool time)
  const stats = computeMessageStats({
    model: llmClient.getModel(),
    mode: 'builder',
    timing: result.timing,
    usage: result.usage,
    toolTime: totalToolTime / 1000,
    totalTimeOverride: (performance.now() - startTime) / 1000,
  })
  
  sessionManager.updateMessageStats(sessionId, result.messageId, stats)
  onMessage(createChatDoneMessage(result.messageId, 'complete', stats))
  
  return {
    messageId: result.messageId,
    hasToolCalls: result.toolCalls.length > 0,
    content: result.content,
    timing: result.timing,
    usage: result.usage,
  }
}
