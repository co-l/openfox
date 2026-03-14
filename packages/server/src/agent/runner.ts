import type { Criterion, CriterionStatus, ToolCall, ToolResult } from '@openfox/shared'
import type { AgentEvent } from '@openfox/shared/protocol'
import type { LLMMessage } from '../llm/types.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ToolRegistry } from '../tools/index.js'
import type { Config } from '../config.js'
import { sessionManager } from '../session/index.js'
import { buildAgentSystemPrompt } from './prompts.js'
import { streamWithSegments, type StreamTiming } from '../llm/streaming.js'
import { AskUserInterrupt } from '../tools/index.js'
import { estimateTokens } from '../context/tokenizer.js'
import { shouldCompact, getCompactionTarget, compactMessages } from '../context/index.js'
import { logger } from '../utils/logger.js'

// Constants for XML tool format retry
const MAX_FORMAT_RETRIES = 10
const FORMAT_CORRECTION_PROMPT = `IMPORTANT: You MUST use the JSON function calling API. Do NOT output XML tags like <tool_call>, <function=>, or <parameter=>. Your previous attempt was stopped because you used the wrong format. Use the proper tool_calls format.`

export interface AgentRunnerOptions {
  sessionId: string
  llmClient: LLMClientWithModel
  toolRegistry: ToolRegistry
  config: Config
  signal?: AbortSignal
  onEvent: (event: AgentEvent) => void
}

export async function runAgent(options: AgentRunnerOptions): Promise<void> {
  const { sessionId, llmClient, toolRegistry, config, signal, onEvent } = options
  
  let session = sessionManager.requireSession(sessionId)
  let iteration = 0
  const maxIterations = config.agent.maxIterations * session.criteria.length
  let formatRetryCount = 0
  
  // Track aggregated metrics
  const startTime = performance.now()
  let totalPrefillTokens = 0
  let totalPrefillTime = 0
  let totalGenTokens = 0
  let totalGenTime = 0
  let totalToolTime = 0
  
  // Helper to build stats for done event
  const buildStats = () => ({
    model: llmClient.getModel(),
    mode: session.mode,
    totalTime: (performance.now() - startTime) / 1000,
    toolTime: totalToolTime,
    prefillTokens: totalPrefillTokens,
    prefillSpeed: totalPrefillTime > 0 ? Math.round(totalPrefillTokens / totalPrefillTime) : 0,
    generationTokens: totalGenTokens,
    generationSpeed: totalGenTime > 0 ? Math.round(totalGenTokens / totalGenTime) : 0,
  })
  
  logger.info('Starting agent run', { sessionId, criteria: session.criteria.length })
  
  while (iteration < maxIterations) {
    // Check for abort at start of each iteration
    if (signal?.aborted) {
      logger.info('Agent aborted', { sessionId, iteration })
      onEvent({ type: 'aborted' })
      return
    }
    
    iteration++
    session = sessionManager.requireSession(sessionId)
    
    // Check if all criteria are passed
    const allPassed = session.criteria.every(c => c.status.type === 'passed')
    if (allPassed) {
      logger.info('All criteria passed', { sessionId })
      onEvent({
        type: 'done',
        allCriteriaPassed: true,
        summary: 'All acceptance criteria have been satisfied.',
        stats: buildStats(),
      })
      sessionManager.transition(sessionId, 'validating')
      return
    }
    
    // Check if we're stuck
    const execState = session.executionState
    if (execState && execState.consecutiveFailures >= config.agent.maxConsecutiveFailures) {
      logger.warn('Agent stuck', { sessionId, failures: execState.consecutiveFailures })
      onEvent({
        type: 'stuck',
        reason: execState.lastFailureReason ?? 'Too many consecutive failures',
        failedAttempts: execState.consecutiveFailures,
      })
      return
    }
    
    // Check context size and compact if needed
    const currentTokens = execState?.currentTokenCount ?? 0
    if (shouldCompact(currentTokens, config.context.maxTokens, config.context.compactionThreshold)) {
      const target = getCompactionTarget(config.context.maxTokens, config.context.compactionTarget)
      const result = await compactMessages(
        session.messages,
        session.criteria,
        target,
        llmClient
      )
      
      if (result) {
        sessionManager.compactMessages(sessionId, result.removedMessageIds, result.summary)
        sessionManager.updateExecutionState(sessionId, {
          currentTokenCount: result.tokensAfter,
          compactionCount: (execState?.compactionCount ?? 0) + 1,
        })
        
        onEvent({
          type: 'context_compaction',
          beforeTokens: result.tokensBefore,
          afterTokens: result.tokensAfter,
        })
        
        // Refresh session
        session = sessionManager.requireSession(sessionId)
      }
    }
    
    // If retrying due to XML format error, inject correction prompt
    if (formatRetryCount > 0) {
      sessionManager.addMessage(sessionId, {
        role: 'user',
        content: FORMAT_CORRECTION_PROMPT,
        tokenCount: estimateTokens(FORMAT_CORRECTION_PROMPT),
        isSystemGenerated: true,
      })
      session = sessionManager.requireSession(sessionId)
      onEvent({ type: 'format_retry', attempt: formatRetryCount, maxAttempts: MAX_FORMAT_RETRIES })
      formatRetryCount = 0  // Reset after injecting
    }
    
    // Build messages for LLM
    const systemPrompt = buildAgentSystemPrompt(
      session.criteria,
      toolRegistry.definitions,
      execState?.modifiedFiles ?? []
    )
    
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...session.messages
        .filter(m => !m.isCompacted || m.role === 'system')
        .map(m => {
          if (m.role === 'tool' && m.toolCallId && m.toolResult) {
            return {
              role: 'tool' as const,
              content: m.toolResult.success 
                ? (m.toolResult.output ?? 'Success')
                : `Error: ${m.toolResult.error}`,
              toolCallId: m.toolCallId,
            }
          }
          return {
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            toolCalls: m.toolCalls,
          }
        }),
    ]
    
    // Stream LLM response with segment tracking
    const stream = streamWithSegments(llmClient, {
      messages,
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
    })
    
    let streamResult: Awaited<ReturnType<typeof stream.next>>['value'] = null
    let streamError = false
    
    // Track accumulated content for partial message on abort
    let accumulatedContent = ''
    let accumulatedThinking = ''
    
    // Forward streaming events and get final result
    while (true) {
      if (signal?.aborted) {
        // Save partial message if we have any content
        if (accumulatedContent || accumulatedThinking) {
          sessionManager.addMessage(sessionId, {
            role: 'assistant',
            content: accumulatedContent,
            thinkingContent: accumulatedThinking || undefined,
            tokenCount: 0,
            partial: true,
          })
        }
        logger.info('Agent aborted during streaming', { sessionId, iteration })
        onEvent({ type: 'aborted' })
        return
      }
      
      const { value, done } = await stream.next()
      
      if (done) {
        streamResult = value
        break
      }
      
      // Forward streaming events and accumulate content
      switch (value.type) {
        case 'text_delta':
          accumulatedContent += value.content
          onEvent({ type: 'text_delta', content: value.content })
          break
        case 'thinking_delta':
          accumulatedThinking += value.content
          onEvent({ type: 'thinking', content: value.content })
          break
        case 'xml_tool_abort': {
          // Model used XML tool format - retry this iteration
          formatRetryCount++
          if (formatRetryCount <= MAX_FORMAT_RETRIES) {
            logger.warn('XML tool format detected in agent, retrying', { 
              sessionId, 
              attempt: formatRetryCount 
            })
            break  // Exit inner while loop, continue outer loop
          } else {
            onEvent({ type: 'error', error: 'Model repeatedly used XML tool format after 10 retries', recoverable: false })
            onEvent({ type: 'done', allCriteriaPassed: false, summary: 'Failed due to model format issues', stats: buildStats() })
            return
          }
        }
        case 'error':
          onEvent({ type: 'error', error: value.error, recoverable: true })
          sessionManager.recordToolFailure(sessionId, 'llm', value.error)
          streamError = true
          break
      }
      
      // If we got xml_tool_abort, break out to retry
      if (value.type === 'xml_tool_abort' && formatRetryCount <= MAX_FORMAT_RETRIES) {
        break
      }
    }
    
    // If we broke out due to xml_tool_abort, continue to next iteration
    if (!streamResult && formatRetryCount > 0 && formatRetryCount <= MAX_FORMAT_RETRIES) {
      continue
    }
    
    // Handle stream errors
    if (streamError || !streamResult) {
      logger.error('LLM stream error', { sessionId })
      continue
    }
    
    const { content: fullContent, thinkingContent, toolCalls, response, segments, timing } = streamResult
    
    // Accumulate LLM metrics
    totalPrefillTokens += response.usage.promptTokens
    totalPrefillTime += timing.ttft
    totalGenTokens += response.usage.completionTokens
    totalGenTime += timing.completionTime
    
    // Update context size (for compaction decisions) and cumulative usage (for metrics)
    sessionManager.setCurrentContextSize(sessionId, response.usage.promptTokens)
    sessionManager.addTokensUsed(sessionId, response.usage.promptTokens + response.usage.completionTokens)
    
    // Save assistant message with segments for proper ordering on reload
    sessionManager.addMessage(sessionId, {
      role: 'assistant',
      content: fullContent,
      thinkingContent: thinkingContent || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      tokenCount: estimateTokens(fullContent),
      segments,
    })
    
    // Check for completion signal
    if (fullContent.includes('ALL CRITERIA COMPLETE')) {
      logger.info('Agent signaled completion', { sessionId })
      onEvent({
        type: 'done',
        allCriteriaPassed: true,
        summary: 'Agent reports all criteria complete. Starting validation.',
        stats: buildStats(),
      })
      sessionManager.transition(sessionId, 'validating')
      return
    }
    
    // Execute tool calls
    if (toolCalls.length > 0) {
      sessionManager.resetToolFailures(sessionId)
      
      for (const toolCall of toolCalls) {
        // Check for abort before each tool execution
        if (signal?.aborted) {
          logger.info('Agent aborted during tool execution', { sessionId })
          onEvent({ type: 'aborted' })
          return
        }
        
        onEvent({
          type: 'tool_call',
          callId: toolCall.id,
          tool: toolCall.name,
          args: toolCall.arguments,
        })
        
        sessionManager.incrementToolCalls(sessionId)
        
        try {
          const result = await toolRegistry.execute(
            toolCall.name,
            toolCall.arguments,
            {
              workdir: session.workdir,
              sessionId,
            }
          )
          
          // Track tool execution time
          totalToolTime += result.durationMs / 1000
          
          // Save tool result message
          sessionManager.addMessage(sessionId, {
            role: 'tool',
            content: result.success ? (result.output ?? 'Success') : `Error: ${result.error}`,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolResult: result,
            tokenCount: estimateTokens(result.output ?? result.error ?? ''),
          })
          
          onEvent({
            type: 'tool_result',
            callId: toolCall.id,
            tool: toolCall.name,
            result,
          })
          
          // Track modified files
          if (result.success && ['write_file', 'edit_file'].includes(toolCall.name)) {
            const path = toolCall.arguments['path'] as string
            sessionManager.addModifiedFile(sessionId, path)
          }
          
          if (!result.success) {
            onEvent({
              type: 'tool_error',
              callId: toolCall.id,
              tool: toolCall.name,
              error: result.error ?? 'Unknown error',
              willRetry: true,
            })
            sessionManager.recordToolFailure(sessionId, toolCall.name, result.error ?? 'Unknown')
          }
        } catch (error) {
          // Handle ask_user interrupt
          if (error instanceof AskUserInterrupt) {
            onEvent({
              type: 'ask_user',
              question: error.question,
              callId: error.callId,
            })
            // Pause execution - will be resumed when user responds
            return
          }
          
          logger.error('Tool execution error', { tool: toolCall.name, error })
          
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          
          sessionManager.addMessage(sessionId, {
            role: 'tool',
            content: `Error: ${errorMsg}`,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolResult: {
              success: false,
              error: errorMsg,
              durationMs: 0,
              truncated: false,
            },
            tokenCount: estimateTokens(errorMsg),
          })
          
          onEvent({
            type: 'tool_error',
            callId: toolCall.id,
            tool: toolCall.name,
            error: errorMsg,
            willRetry: true,
          })
          
          sessionManager.recordToolFailure(sessionId, toolCall.name, errorMsg)
        }
      }
    }
    
    // If no tool calls and no completion signal, the model might be confused
    if (toolCalls.length === 0 && !fullContent.includes('ALL CRITERIA COMPLETE')) {
      // Give it another chance with a nudge
      sessionManager.addMessage(sessionId, {
        role: 'user',
        content: 'Continue working on the acceptance criteria. Use the available tools to make progress. When finished, output "ALL CRITERIA COMPLETE".',
        tokenCount: 50,
      })
    }
  }
  
  // Max iterations reached
  logger.warn('Agent reached max iterations', { sessionId, iterations: iteration })
  onEvent({
    type: 'stuck',
    reason: 'Maximum iterations reached',
    failedAttempts: iteration,
  })
}
