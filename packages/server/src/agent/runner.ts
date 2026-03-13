import type { Criterion, CriterionStatus, ToolCall, ToolResult } from '@openfox/shared'
import type { AgentEvent } from '@openfox/shared/protocol'
import type { LLMClient, LLMMessage } from '../llm/types.js'
import type { ToolRegistry } from '../tools/index.js'
import type { Config } from '../config.js'
import { sessionManager } from '../session/index.js'
import { buildAgentSystemPrompt } from './prompts.js'
import { AskUserInterrupt } from '../tools/index.js'
import { estimateTokens } from '../context/tokenizer.js'
import { shouldCompact, getCompactionTarget, compactMessages } from '../context/index.js'
import { logger } from '../utils/logger.js'

export interface AgentRunnerOptions {
  sessionId: string
  llmClient: LLMClient
  toolRegistry: ToolRegistry
  config: Config
  onEvent: (event: AgentEvent) => void
}

export async function runAgent(options: AgentRunnerOptions): Promise<void> {
  const { sessionId, llmClient, toolRegistry, config, onEvent } = options
  
  let session = sessionManager.requireSession(sessionId)
  let iteration = 0
  const maxIterations = config.agent.maxIterations * session.criteria.length
  
  logger.info('Starting agent run', { sessionId, criteria: session.criteria.length })
  
  while (iteration < maxIterations) {
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
    
    // Stream LLM response
    let fullContent = ''
    let thinkingContent = ''
    let toolCalls: ToolCall[] = []
    
    try {
      for await (const event of llmClient.stream({
        messages,
        tools: toolRegistry.definitions,
        toolChoice: 'auto',
      })) {
        switch (event.type) {
          case 'text_delta':
            fullContent += event.content
            onEvent({ type: 'text_delta', content: event.content })
            break
          
          case 'thinking_delta':
            thinkingContent += event.content
            onEvent({ type: 'thinking', content: event.content })
            break
          
          case 'done':
            toolCalls = event.response.toolCalls ?? []
            
            // Update token count
            sessionManager.incrementTokenCount(
              sessionId,
              event.response.usage.promptTokens + event.response.usage.completionTokens
            )
            break
          
          case 'error':
            onEvent({ type: 'error', error: event.error, recoverable: true })
            sessionManager.recordToolFailure(sessionId, 'llm', event.error)
            continue
        }
      }
    } catch (error) {
      logger.error('LLM stream error', { error })
      onEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        recoverable: true,
      })
      sessionManager.recordToolFailure(sessionId, 'llm', String(error))
      continue
    }
    
    // Save assistant message
    sessionManager.addMessage(sessionId, {
      role: 'assistant',
      content: fullContent,
      thinkingContent: thinkingContent || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      tokenCount: estimateTokens(fullContent),
    })
    
    // Check for completion signal
    if (fullContent.includes('ALL CRITERIA COMPLETE')) {
      logger.info('Agent signaled completion', { sessionId })
      onEvent({
        type: 'done',
        allCriteriaPassed: true,
        summary: 'Agent reports all criteria complete. Starting validation.',
      })
      sessionManager.transition(sessionId, 'validating')
      return
    }
    
    // Execute tool calls
    if (toolCalls.length > 0) {
      sessionManager.resetToolFailures(sessionId)
      
      for (const toolCall of toolCalls) {
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
