/**
 * Verifier Worker
 * 
 * Runs verification on all completed criteria.
 * Uses fresh context (not the full conversation) for efficient verification.
 */

import type { ToolCall } from '@openfox/shared'
import type { ServerMessage } from '@openfox/shared/protocol'
import type { LLMClientWithModel } from '../llm/client.js'
import type { StepResult } from '../runner/types.js'
import { sessionManager } from '../session/index.js'
import { getToolRegistryForMode } from '../tools/index.js'
import { buildVerifierPrompt, VERIFIER_KICKOFF_PROMPT } from './prompts.js'
import { streamLLMResponse } from './stream.js'
import { computeAggregatedStats } from './stats.js'
import { estimateTokens } from '../context/tokenizer.js'
import { logger } from '../utils/logger.js'
import {
  createChatToolCallMessage,
  createChatToolResultMessage,
  createChatMessageMessage,
  createChatDoneMessage,
  createCriteriaUpdatedMessage,
} from '../ws/protocol.js'

export interface VerifierStepOptions {
  sessionId: string
  llmClient: LLMClientWithModel
  signal?: AbortSignal
  onMessage: (msg: ServerMessage) => void
}

export interface VerificationResult {
  allPassed: boolean
  failed: Array<{ id: string; reason: string }>
}

/**
 * Run verification on all completed criteria.
 * Uses fresh context with just the summary and criteria info.
 */
export async function runVerifierStep(options: VerifierStepOptions): Promise<StepResult & VerificationResult> {
  const { sessionId, llmClient, signal, onMessage } = options
  const startTime = performance.now()
  const subAgentId = crypto.randomUUID()
  
  let session = sessionManager.requireSession(sessionId)
  
  // Check if there's anything to verify
  const toVerify = session.criteria.filter(c => c.status.type === 'completed')
  if (toVerify.length === 0) {
    logger.info('Nothing to verify', { sessionId })
    return {
      messageId: '',
      hasToolCalls: false,
      content: '',
      timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
      usage: { promptTokens: 0, completionTokens: 0 },
      allPassed: true,
      failed: [],
    }
  }
  
  // Extract context for verifier
  const summary = session.summary ?? 'No summary available'
  const modifiedFiles = session.executionState?.modifiedFiles ?? []
  
  // Build criteria list for display
  const criteriaList = session.criteria
    .map(c => {
      const status = c.status.type === 'passed' ? '[PASSED]'
        : c.status.type === 'completed' ? '[NEEDS VERIFICATION]'
        : c.status.type === 'failed' ? '[FAILED]'
        : '[NOT COMPLETED]'
      return `- **${c.id}** ${status}: ${c.description}`
    })
    .join('\n')
  
  const contextContent = `## Task Summary
${summary}

## Criteria
${criteriaList}

## Modified Files
${modifiedFiles.length > 0 ? modifiedFiles.map(f => `- ${f}`).join('\n') : '(none)'}`
  
  logger.info('Verifier starting', { 
    sessionId, 
    subAgentId,
    criteriaCount: session.criteria.length,
  })
  
  // Add context reset separator
  const resetMsg = sessionManager.addMessage(sessionId, {
    role: 'user',
    content: 'Fresh Context',
    tokenCount: 2,
    isSystemGenerated: true,
    messageKind: 'context-reset',
    subAgentId,
    subAgentType: 'verifier',
  })
  onMessage(createChatMessageMessage(resetMsg))
  
  // Add visible context message
  const contextMsg = sessionManager.addMessage(sessionId, {
    role: 'user',
    content: contextContent,
    tokenCount: estimateTokens(contextContent),
    isSystemGenerated: true,
    messageKind: 'auto-prompt',
    subAgentId,
    subAgentType: 'verifier',
  })
  onMessage(createChatMessageMessage(contextMsg))
  
  // Add verifier kickoff prompt
  const kickoffMsg = sessionManager.addMessage(sessionId, {
    role: 'user',
    content: VERIFIER_KICKOFF_PROMPT,
    tokenCount: estimateTokens(VERIFIER_KICKOFF_PROMPT),
    isSystemGenerated: true,
    messageKind: 'auto-prompt',
    subAgentId,
    subAgentType: 'verifier',
  })
  onMessage(createChatMessageMessage(kickoffMsg))
  
  const toolRegistry = getToolRegistryForMode('verifier')
  const systemPrompt = buildVerifierPrompt(toolRegistry.definitions)
  
  // Verifier uses fresh context
  const customMessages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; toolCalls?: ToolCall[]; toolCallId?: string }> = [
    { role: 'user', content: contextContent },
    { role: 'user', content: VERIFIER_KICKOFF_PROMPT },
  ]
  
  let iteration = 0
  const maxIterations = 20
  let currentMessageId: string | undefined
  let totalToolTime = 0
  let totalPrefillTokens = 0
  let totalGenTokens = 0
  let totalPrefillTime = 0
  let totalGenTime = 0
  
  while (iteration < maxIterations) {
    if (signal?.aborted) {
      if (currentMessageId) {
        onMessage(createChatDoneMessage(currentMessageId, 'stopped'))
      }
      throw new Error('Aborted')
    }
    
    iteration++
    
    // Stream LLM response with fresh context (no thinking for verifier)
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
        customMessages,
        subAgentId,
        subAgentType: 'verifier',
        enableThinking: false,
      })
    } catch (error) {
      throw error
    }
    
    currentMessageId = result.messageId
    
    // Track metrics
    totalPrefillTokens += result.usage.promptTokens
    totalGenTokens += result.usage.completionTokens
    totalPrefillTime += result.timing.ttft
    totalGenTime += result.timing.completionTime
    
    // Add assistant response to custom context
    customMessages.push({
      role: 'assistant',
      content: result.content,
      ...(result.toolCalls.length > 0 && { toolCalls: result.toolCalls }),
    })
    
    // Execute tool calls
    if (result.toolCalls.length > 0) {
      for (const toolCall of result.toolCalls) {
        onMessage(createChatToolCallMessage(currentMessageId, toolCall.id, toolCall.name, toolCall.arguments))
        
        const toolResult = await toolRegistry.execute(
          toolCall.name,
          toolCall.arguments,
          { workdir: session.workdir, sessionId }
        )
        
        totalToolTime += toolResult.durationMs
        
        onMessage(createChatToolResultMessage(currentMessageId, toolCall.id, toolCall.name, toolResult))
        
        // Add tool result to custom context
        customMessages.push({
          role: 'tool',
          content: toolResult.success ? (toolResult.output ?? 'Success') : `Error: ${toolResult.error}`,
          toolCallId: toolCall.id,
        })
        
        // Check if criteria changed
        const updatedSession = sessionManager.requireSession(sessionId)
        if (JSON.stringify(updatedSession.criteria) !== JSON.stringify(session.criteria)) {
          onMessage(createCriteriaUpdatedMessage(updatedSession.criteria))
          session = updatedSession
        }
      }
      
      continue
    }
    
    break
  }
  
  // Check results
  session = sessionManager.requireSession(sessionId)
  const failed = session.criteria
    .filter(c => c.status.type === 'failed')
    .map(c => ({ 
      id: c.id, 
      reason: c.status.type === 'failed' ? c.status.reason : 'unknown' 
    }))
  
  // Build and send stats (aggregated from multiple LLM calls)
  const stats = computeAggregatedStats({
    model: llmClient.getModel(),
    mode: 'verifier',
    totalPrefillTokens,
    totalGenTokens,
    totalPrefillTime,
    totalGenTime,
    totalToolTime: totalToolTime / 1000,
    totalTime: (performance.now() - startTime) / 1000,
  })
  
  if (currentMessageId) {
    sessionManager.updateMessageStats(sessionId, currentMessageId, stats)
    onMessage(createChatDoneMessage(currentMessageId, 'complete', stats))
  }
  
  if (failed.length > 0) {
    logger.info('Verification failed', { sessionId, failed: failed.length })
  } else {
    logger.info('All criteria verified', { sessionId })
  }
  
  return {
    messageId: currentMessageId ?? '',
    hasToolCalls: false,  // Verifier completes when no more tool calls
    content: '',
    timing: { 
      ttft: totalPrefillTime, 
      completionTime: totalGenTime,
      tps: totalGenTokens / (totalGenTime || 1),
      prefillTps: totalPrefillTokens / (totalPrefillTime || 1),
    },
    usage: { promptTokens: totalPrefillTokens, completionTokens: totalGenTokens },
    allPassed: failed.length === 0,
    failed,
  }
}
