import type { Session, SessionMode, ToolMode, ToolCall, Todo, MessageStats, Message } from '@openfox/shared'
import type { ServerMessage } from '@openfox/shared/protocol'
import type { LLMClientWithModel } from '../llm/client.js'
import { sessionManager } from '../session/index.js'
import { getToolRegistryForMode, setTodoUpdateCallback, AskUserInterrupt } from '../tools/index.js'
import { streamWithSegments, type StreamTiming } from '../llm/streaming.js'
import { buildPlannerPrompt, buildBuilderPrompt, buildVerifierPrompt, SUMMARY_REQUEST_PROMPT, BUILDER_KICKOFF_PROMPT, VERIFIER_KICKOFF_PROMPT } from './prompts.js'
export { SUMMARY_REQUEST_PROMPT }
import { estimateTokens } from '../context/tokenizer.js'
import { logger } from '../utils/logger.js'
import {
  createChatDeltaMessage,
  createChatThinkingMessage,
  createChatToolCallMessage,
  createChatToolResultMessage,
  createChatTodoMessage,
  createChatSummaryMessage,
  createChatDoneMessage,
  createChatErrorMessage,
  createChatFormatRetryMessage,
  createChatMessageMessage,
  createModeChangedMessage,
  createCriteriaUpdatedMessage,
} from '../ws/protocol.js'

// Constants for XML tool format retry
const MAX_FORMAT_RETRIES = 10
const FORMAT_CORRECTION_PROMPT = `IMPORTANT: You MUST use the JSON function calling API. Do NOT output XML tags like <tool_call>, <function=>, or <parameter=>. Your previous attempt was stopped because you used the wrong format. Use the proper tool_calls format.`

export interface ChatOptions {
  sessionId: string
  llmClient: LLMClientWithModel
  signal?: AbortSignal
  onMessage: (msg: ServerMessage) => void
}



/**
 * Tracks aggregated metrics across a full turn (multiple LLM calls + tool executions)
 */
class TurnMetrics {
  private startTime: number
  private totalPrefillTokens = 0
  private totalPrefillTime = 0  // seconds
  private totalGenTokens = 0
  private totalGenTime = 0      // seconds
  private totalToolTime = 0     // seconds
  
  constructor() {
    this.startTime = performance.now()
  }
  
  /** Add metrics from an LLM call */
  addLLMCall(timing: StreamTiming, promptTokens: number, completionTokens: number) {
    this.totalPrefillTokens += promptTokens
    this.totalPrefillTime += timing.ttft
    this.totalGenTokens += completionTokens
    this.totalGenTime += timing.completionTime
  }
  
  /** Add tool execution time (in milliseconds) */
  addToolTime(durationMs: number) {
    this.totalToolTime += durationMs / 1000
  }
  
  /** Build final stats object */
  buildStats(model: string, mode: ToolMode): MessageStats {
    const totalTime = (performance.now() - this.startTime) / 1000
    // Keep 1 decimal place precision for speeds
    const roundTo1 = (n: number) => Math.round(n * 10) / 10
    return {
      model,
      mode,
      totalTime,
      toolTime: this.totalToolTime,
      prefillTokens: this.totalPrefillTokens,
      prefillSpeed: this.totalPrefillTime > 0 
        ? roundTo1(this.totalPrefillTokens / this.totalPrefillTime) 
        : 0,
      generationTokens: this.totalGenTokens,
      generationSpeed: this.totalGenTime > 0 
        ? roundTo1(this.totalGenTokens / this.totalGenTime) 
        : 0,
    }
  }
}

/**
 * Handle a chat interaction in the current mode
 */
export async function handleChat(options: ChatOptions): Promise<void> {
  const { sessionId, llmClient, signal, onMessage } = options
  
  let session = sessionManager.requireSession(sessionId)
  const mode = session.mode
  
  logger.info('Starting chat', { sessionId, mode })
  
  // Set up todo callback
  setTodoUpdateCallback((sid, todos) => {
    if (sid === sessionId) {
      onMessage(createChatTodoMessage(todos))
    }
  })
  
  try {
    // Run the appropriate handler based on mode
    switch (mode) {
      case 'planner':
        await runPlannerChat(options)
        break
      case 'builder':
        await runBuilderLoop(options)
        break
    }
  } catch (error) {
    if (error instanceof AskUserInterrupt) {
      // User intervention requested - pause execution
      // Create a system message to notify user and get a messageId
      const waitMsg = sessionManager.addMessage(sessionId, {
        role: 'user',
        content: 'Waiting for user input...',
        tokenCount: 5,
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
      })
      onMessage(createChatMessageMessage(waitMsg))
      onMessage(createChatDoneMessage(waitMsg.id, 'waiting_for_user'))
      return
    }
    
    logger.error('Chat error', { sessionId, mode, error })
    onMessage(createChatErrorMessage(
      error instanceof Error ? error.message : 'Unknown error',
      false
    ))
    // Create error message to get a messageId for done event
    const errorMsg = sessionManager.addMessage(sessionId, {
      role: 'user',
      content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      tokenCount: 10,
      isSystemGenerated: true,
      messageKind: 'correction',
    })
    onMessage(createChatMessageMessage(errorMsg))
    onMessage(createChatDoneMessage(errorMsg.id, 'error'))
  } finally {
    sessionManager.setRunning(sessionId, false)
  }
}

/**
 * Planner mode: Single response to help define criteria
 * Uses TurnMetrics to track aggregated metrics across recursive calls
 * 
 * Server-authoritative streaming: Creates assistant message BEFORE streaming,
 * sends deltas with messageId, client just renders messages array.
 */
async function runPlannerChat(
  options: ChatOptions, 
  metrics?: TurnMetrics,
  formatRetryCount = 0,
  assistantMessageId?: string
): Promise<void> {
  const { sessionId, llmClient, signal, onMessage } = options
  const turnMetrics = metrics ?? new TurnMetrics()
  
  let session = sessionManager.requireSession(sessionId)
  
  // If retrying due to XML format error, inject correction prompt
  if (formatRetryCount > 0) {
    const correctionMsg = sessionManager.addMessage(sessionId, {
      role: 'user',
      content: FORMAT_CORRECTION_PROMPT,
      tokenCount: estimateTokens(FORMAT_CORRECTION_PROMPT),
      isSystemGenerated: true,
    })
    session = sessionManager.requireSession(sessionId)
    onMessage(createChatMessageMessage(correctionMsg))
    onMessage(createChatFormatRetryMessage(formatRetryCount, MAX_FORMAT_RETRIES))
  }
  
  const toolRegistry = getToolRegistryForMode('planner')
  
  const systemPrompt = buildPlannerPrompt(toolRegistry.definitions)
  
  const llmMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...session.messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'tool',
      content: m.content,
      ...(m.toolCalls && { toolCalls: m.toolCalls }),
      ...(m.toolCallId && { toolCallId: m.toolCallId }),
    })),
  ]
  
  // Create assistant message BEFORE streaming starts (server-authoritative)
  // Reuse existing messageId on recursive calls (tool loops)
  let messageId = assistantMessageId
  if (!messageId) {
    const assistantMsg = sessionManager.addMessage(sessionId, {
      role: 'assistant',
      content: '',
      tokenCount: 0,
      isStreaming: true,
    })
    messageId = assistantMsg.id
    onMessage(createChatMessageMessage(assistantMsg))
  }
  
  // Stream response
  const stream = streamWithSegments(llmClient, {
    messages: llmMessages,
    tools: toolRegistry.definitions,
    toolChoice: 'auto',
  })
  
  let result: Awaited<ReturnType<typeof stream.next>>['value'] = null
  
  while (true) {
    if (signal?.aborted) {
      // Mark message as no longer streaming (partial content preserved)
      sessionManager.updateMessage(sessionId, messageId, { isStreaming: false, partial: true })
      onMessage(createChatDoneMessage(messageId, 'stopped'))
      return
    }
    
    const { value, done } = await stream.next()
    
    if (done) {
      result = value
      break
    }
    
    // Forward streaming events with messageId
    switch (value.type) {
      case 'text_delta':
        onMessage(createChatDeltaMessage(messageId, value.content))
        break
      case 'thinking_delta':
        onMessage(createChatThinkingMessage(messageId, value.content))
        break
      case 'xml_tool_abort': {
        // Model used XML tool format - retry
        const newRetryCount = formatRetryCount + 1
        if (newRetryCount <= MAX_FORMAT_RETRIES) {
          logger.warn('XML tool format detected in planner, retrying', { 
            sessionId, 
            attempt: newRetryCount 
          })
          onMessage(createChatFormatRetryMessage(newRetryCount, MAX_FORMAT_RETRIES))
          return await runPlannerChat(options, turnMetrics, newRetryCount, messageId)
        } else {
          onMessage(createChatErrorMessage('Model repeatedly used XML tool format after 10 retries', false))
          onMessage(createChatDoneMessage(messageId, 'error'))
          return
        }
      }
      case 'error':
        onMessage(createChatErrorMessage(value.error, true))
        break
    }
  }
  
  if (!result) {
    onMessage(createChatDoneMessage(messageId, 'error'))
    return
  }
  
  const { content, thinkingContent, toolCalls, response, segments, timing } = result
  
  // Track LLM metrics
  turnMetrics.addLLMCall(timing, response.usage.promptTokens, response.usage.completionTokens)
  
  // Update assistant message with final content
  sessionManager.updateMessage(sessionId, messageId, {
    content,
    ...(thinkingContent && { thinkingContent }),
    ...(toolCalls.length > 0 && { toolCalls }),
    tokenCount: response.usage.completionTokens,
    segments,
    isStreaming: false,
  })
  
  // Execute any tool calls (planner has read + criteria tools)
  if (toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      onMessage(createChatToolCallMessage(messageId, toolCall.id, toolCall.name, toolCall.arguments))
      
      const result = await toolRegistry.execute(
        toolCall.name,
        toolCall.arguments,
        { workdir: session.workdir, sessionId }
      )
      
      // Track tool execution time
      turnMetrics.addToolTime(result.durationMs)
      
      onMessage(createChatToolResultMessage(messageId, toolCall.id, toolCall.name, result))
      
      // Save tool result as separate message for LLM context
      const toolMsg = sessionManager.addMessage(sessionId, {
        role: 'tool',
        content: result.success ? (result.output ?? 'Success') : `Error: ${result.error}`,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        toolResult: result,
        tokenCount: estimateTokens(result.output ?? result.error ?? ''),
      })
      onMessage(createChatMessageMessage(toolMsg))
      
      // Check if criteria changed (planner can add/update/remove criteria)
      const updatedSession = sessionManager.requireSession(sessionId)
      if (JSON.stringify(updatedSession.criteria) !== JSON.stringify(session.criteria)) {
        onMessage(createCriteriaUpdatedMessage(updatedSession.criteria))
        session = updatedSession
      }
    }
    
    // Continue with another response if we had tool calls
    // Pass metrics through to accumulate across recursive calls
    // Create NEW assistant message for next response
    return await runPlannerChat(options, turnMetrics, 0)
  }
  
  // Final response - build aggregated stats
  const stats = turnMetrics.buildStats(llmClient.getModel(), 'planner')
  
  // Update the message with stats
  sessionManager.updateMessageStats(sessionId, messageId, stats)
  
  onMessage(createChatDoneMessage(messageId, 'complete', stats))
}

/**
 * Builder mode: Loop until all criteria completed or stuck
 * Uses TurnMetrics to track aggregated metrics across the turn
 * 
 * Server-authoritative streaming: Creates assistant message BEFORE streaming,
 * sends deltas with messageId, client just renders messages array.
 */
async function runBuilderLoop(options: ChatOptions): Promise<void> {
  const { sessionId, llmClient, signal, onMessage } = options
  const turnMetrics = new TurnMetrics()
  
  let session = sessionManager.requireSession(sessionId)
  let iteration = 0
  const maxIterations = 50 // Safety limit
  let formatRetryCount = 0
  // Track current assistant message ID across iterations
  let currentMessageId: string | undefined
  
  // Add kickoff prompt on first entry (not on re-entry from verifier failure)
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
    // Refresh session after adding message
    session = sessionManager.requireSession(sessionId)
  }
  
  while (iteration < maxIterations) {
    if (signal?.aborted) {
      if (currentMessageId) {
        sessionManager.updateMessage(sessionId, currentMessageId, { isStreaming: false, partial: true })
        onMessage(createChatDoneMessage(currentMessageId, 'stopped'))
      }
      return
    }
    
    iteration++
    session = sessionManager.requireSession(sessionId)
    
    // Check if all criteria are completed
    const allCompleted = session.criteria.every(c => 
      c.status.type === 'completed' || c.status.type === 'passed'
    )
    
    if (allCompleted && session.criteria.length > 0) {
      logger.info('All criteria completed, running verification sub-agent', { sessionId })
      
      // Send stats for builder turn before verification
      if (currentMessageId) {
        const stats = turnMetrics.buildStats(llmClient.getModel(), 'builder')
        sessionManager.updateMessageStats(sessionId, currentMessageId, stats)
        onMessage(createChatDoneMessage(currentMessageId, 'complete', stats))
      }
      
      // Run verification as inline sub-agent
      const verificationResult = await runVerificationSubAgent(options)
      
      if (verificationResult.allPassed) {
        // All verified! We're done.
        logger.info('All criteria verified successfully', { sessionId })
        return
      }
      
      // Verification failed - inject failure context and continue builder loop
      logger.info('Verification failed, continuing builder', { sessionId, failed: verificationResult.failed.length })
      
      const failureMsg = sessionManager.addMessage(sessionId, {
        role: 'user',
        content: `Verification found ${verificationResult.failed.length} failing criteria:\n${verificationResult.failed.map(f => `- ${f.id}: ${f.reason}`).join('\n')}`,
        tokenCount: 50,
        isSystemGenerated: true,
        messageKind: 'correction',
      })
      onMessage(createChatMessageMessage(failureMsg))
      
      // Refresh session and continue builder loop
      session = sessionManager.requireSession(sessionId)
      continue
    }
    
    // If retrying due to XML format error, inject correction prompt
    if (formatRetryCount > 0) {
      const correctionMsg = sessionManager.addMessage(sessionId, {
        role: 'user',
        content: FORMAT_CORRECTION_PROMPT,
        tokenCount: estimateTokens(FORMAT_CORRECTION_PROMPT),
        isSystemGenerated: true,
      })
      session = sessionManager.requireSession(sessionId)
      onMessage(createChatMessageMessage(correctionMsg))
      onMessage(createChatFormatRetryMessage(formatRetryCount, MAX_FORMAT_RETRIES))
      formatRetryCount = 0  // Reset after injecting
    }
    
    const toolRegistry = getToolRegistryForMode('builder')
    const systemPrompt = buildBuilderPrompt(
      session.criteria,
      toolRegistry.definitions,
      session.executionState?.modifiedFiles ?? []
    )
    
    const llmMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...session.messages
        .filter(m => !m.isCompacted)
        .map(m => ({
          role: m.role as 'user' | 'assistant' | 'tool',
          content: m.role === 'tool' && m.toolResult
            ? (m.toolResult.success ? (m.toolResult.output ?? 'Success') : `Error: ${m.toolResult.error}`)
            : m.content,
          ...(m.toolCalls && { toolCalls: m.toolCalls }),
          ...(m.toolCallId && { toolCallId: m.toolCallId }),
        })),
    ]
    
    // Create assistant message BEFORE streaming starts (server-authoritative)
    const assistantMsg = sessionManager.addMessage(sessionId, {
      role: 'assistant',
      content: '',
      tokenCount: 0,
      isStreaming: true,
    })
    currentMessageId = assistantMsg.id
    onMessage(createChatMessageMessage(assistantMsg))
    
    // Stream response
    const stream = streamWithSegments(llmClient, {
      messages: llmMessages,
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
    })
    
    let result: Awaited<ReturnType<typeof stream.next>>['value'] = null
    
    while (true) {
      if (signal?.aborted) {
        sessionManager.updateMessage(sessionId, currentMessageId, { isStreaming: false, partial: true })
        onMessage(createChatDoneMessage(currentMessageId, 'stopped'))
        return
      }
      
      const { value, done } = await stream.next()
      
      if (done) {
        result = value
        break
      }
      
      // Forward streaming events with messageId
      switch (value.type) {
        case 'text_delta':
          onMessage(createChatDeltaMessage(currentMessageId, value.content))
          break
        case 'thinking_delta':
          onMessage(createChatThinkingMessage(currentMessageId, value.content))
          break
        case 'xml_tool_abort': {
          // Model used XML tool format - retry this iteration
          formatRetryCount++
          if (formatRetryCount <= MAX_FORMAT_RETRIES) {
            logger.warn('XML tool format detected in builder, retrying', { 
              sessionId, 
              attempt: formatRetryCount 
            })
            onMessage(createChatFormatRetryMessage(formatRetryCount, MAX_FORMAT_RETRIES))
            break  // Exit inner while loop, continue outer loop
          } else {
            onMessage(createChatErrorMessage('Model repeatedly used XML tool format after 10 retries', false))
            onMessage(createChatDoneMessage(currentMessageId, 'error'))
            return
          }
        }
        case 'error':
          onMessage(createChatErrorMessage(value.error, true))
          break
      }
      
      // If we got xml_tool_abort, break out to retry
      if (value.type === 'xml_tool_abort' && formatRetryCount <= MAX_FORMAT_RETRIES) {
        break
      }
    }
    
    // If we broke out due to xml_tool_abort, continue to next iteration
    if (!result && formatRetryCount > 0 && formatRetryCount <= MAX_FORMAT_RETRIES) {
      continue
    }
    
    if (!result) {
      onMessage(createChatDoneMessage(currentMessageId, 'error'))
      return
    }
    
    const { content, thinkingContent, toolCalls, response, segments, timing } = result
    
    // Track LLM metrics
    turnMetrics.addLLMCall(timing, response.usage.promptTokens, response.usage.completionTokens)
    
    // Update assistant message with final content
    sessionManager.updateMessage(sessionId, currentMessageId, {
      content,
      ...(thinkingContent && { thinkingContent }),
      ...(toolCalls.length > 0 && { toolCalls }),
      tokenCount: response.usage.completionTokens,
      segments,
      isStreaming: false,
    })
    
    // Execute tool calls
    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        if (signal?.aborted) {
          onMessage(createChatDoneMessage(currentMessageId, 'stopped'))
          return
        }
        
        onMessage(createChatToolCallMessage(currentMessageId, toolCall.id, toolCall.name, toolCall.arguments))
        
        const result = await toolRegistry.execute(
          toolCall.name,
          toolCall.arguments,
          { workdir: session.workdir, sessionId }
        )
        
        // Track tool execution time
        turnMetrics.addToolTime(result.durationMs)
        
        onMessage(createChatToolResultMessage(currentMessageId, toolCall.id, toolCall.name, result))
        
        // Save tool result as separate message for LLM context
        const toolMsg = sessionManager.addMessage(sessionId, {
          role: 'tool',
          content: result.success ? (result.output ?? 'Success') : `Error: ${result.error}`,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolResult: result,
          tokenCount: estimateTokens(result.output ?? result.error ?? ''),
        })
        onMessage(createChatMessageMessage(toolMsg))
        
        // Track modified files
        if (result.success && ['write_file', 'edit_file'].includes(toolCall.name)) {
          const path = toolCall.arguments['path'] as string
          sessionManager.addModifiedFile(sessionId, path)
        }
        
        // Check if criteria changed
        const updatedSession = sessionManager.requireSession(sessionId)
        if (JSON.stringify(updatedSession.criteria) !== JSON.stringify(session.criteria)) {
          onMessage(createCriteriaUpdatedMessage(updatedSession.criteria))
        }
      }
      
      // Continue loop - will create new assistant message next iteration
      continue
    }
    
    // No tool calls - model is done for now
    // Check if we should auto-continue
    const pendingCriteria = session.criteria.filter(c => 
      c.status.type === 'pending' || c.status.type === 'in_progress'
    )
    
    if (pendingCriteria.length > 0) {
      // Add a nudge message
      const nudgeMsg = sessionManager.addMessage(sessionId, {
        role: 'user',
        content: `Continue working on the remaining criteria. ${pendingCriteria.length} criteria still pending.`,
        tokenCount: 20,
        isSystemGenerated: true,
        messageKind: 'correction',
      })
      onMessage(createChatMessageMessage(nudgeMsg))
      continue
    }
    
    break
  }
  
    // Final response - build aggregated stats
    const stats = turnMetrics.buildStats(llmClient.getModel(), 'builder')
    if (currentMessageId) {
      sessionManager.updateMessageStats(sessionId, currentMessageId, stats)
      onMessage(createChatDoneMessage(currentMessageId, 'complete', stats))
    }
}

/**
 * Verification result returned by the sub-agent
 */
interface VerificationResult {
  allPassed: boolean
  failed: Array<{ id: string; reason: string }>
}

/**
 * Verification sub-agent: Check all completed criteria
 * Runs as an inline sub-agent within the builder, with fresh context.
 * All messages are tagged with subAgentId for UI grouping.
 * 
 * Returns verification results instead of switching modes.
 */
async function runVerificationSubAgent(
  options: ChatOptions
): Promise<VerificationResult> {
  const { sessionId, llmClient, signal, onMessage } = options
  const turnMetrics = new TurnMetrics()
  const subAgentId = crypto.randomUUID()
  
  let session = sessionManager.requireSession(sessionId)
  
  // Check if there's anything to verify
  const toVerify = session.criteria.filter(c => c.status.type === 'completed')
  if (toVerify.length === 0) {
    logger.info('Nothing to verify', { sessionId })
    return { allPassed: true, failed: [] }
  }
  
  // Extract context for verifier (shown to user AND sent to LLM)
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
  
  // Build visible context message (everything the LLM will see in system prompt)
  const contextContent = `## Task Summary
${summary}

## Criteria
${criteriaList}

## Modified Files
${modifiedFiles.length > 0 ? modifiedFiles.map(f => `- ${f}`).join('\n') : '(none)'}`
  
  logger.info('Verifier sub-agent starting', { 
    sessionId, 
    subAgentId,
    summaryLength: summary.length,
    modifiedFilesCount: modifiedFiles.length,
    criteriaCount: session.criteria.length,
  })
  
  // Add context reset separator (verifier uses fresh context)
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
  
  // Add visible context message showing what the verifier knows
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
  
  // System prompt is now static (just instructions + tool list)
  const systemPrompt = buildVerifierPrompt(toolRegistry.definitions)
  
  // Verifier gets fresh context (system prompt + context + kickoff)
  const llmMessages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCalls?: ToolCall[]; toolCallId?: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: contextContent },
    { role: 'user', content: VERIFIER_KICKOFF_PROMPT },
  ]
  
  let iteration = 0
  const maxIterations = 20
  let formatRetryCount = 0
  // Track current assistant message ID
  let currentMessageId: string | undefined
  
  while (iteration < maxIterations) {
    if (signal?.aborted) {
      if (currentMessageId) {
        sessionManager.updateMessage(sessionId, currentMessageId, { isStreaming: false, partial: true })
        onMessage(createChatDoneMessage(currentMessageId, 'stopped'))
      }
      return { allPassed: false, failed: [] }  // Aborted
    }
    
    iteration++
    
    // If retrying due to XML format error, inject correction prompt
    if (formatRetryCount > 0) {
      llmMessages.push({
        role: 'user',
        content: FORMAT_CORRECTION_PROMPT,
      })
      onMessage(createChatFormatRetryMessage(formatRetryCount, MAX_FORMAT_RETRIES))
      formatRetryCount = 0  // Reset after injecting
    }
    
    // Create assistant message BEFORE streaming starts (server-authoritative)
    const assistantMsg = sessionManager.addMessage(sessionId, {
      role: 'assistant',
      content: '',
      tokenCount: 0,
      isStreaming: true,
      subAgentId,
      subAgentType: 'verifier',
    })
    currentMessageId = assistantMsg.id
    onMessage(createChatMessageMessage(assistantMsg))
    
    const stream = streamWithSegments(llmClient, {
      messages: llmMessages,
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
    })
    
    let result: Awaited<ReturnType<typeof stream.next>>['value'] = null
    
    while (true) {
      if (signal?.aborted) {
        sessionManager.updateMessage(sessionId, currentMessageId, { isStreaming: false, partial: true })
        onMessage(createChatDoneMessage(currentMessageId, 'stopped'))
        return { allPassed: false, failed: [] }  // Aborted
      }
      
      const { value, done } = await stream.next()
      
      if (done) {
        result = value
        break
      }
      
      // Forward streaming events with messageId
      switch (value.type) {
        case 'text_delta':
          onMessage(createChatDeltaMessage(currentMessageId, value.content))
          break
        case 'thinking_delta':
          onMessage(createChatThinkingMessage(currentMessageId, value.content))
          break
        case 'xml_tool_abort': {
          // Model used XML tool format - retry this iteration
          formatRetryCount++
          if (formatRetryCount <= MAX_FORMAT_RETRIES) {
            logger.warn('XML tool format detected in verifier, retrying', { 
              sessionId, 
              attempt: formatRetryCount 
            })
            onMessage(createChatFormatRetryMessage(formatRetryCount, MAX_FORMAT_RETRIES))
            break  // Exit inner while loop, continue outer loop
          } else {
            onMessage(createChatErrorMessage('Model repeatedly used XML tool format after 10 retries', false))
            onMessage(createChatDoneMessage(currentMessageId, 'error'))
            return { allPassed: false, failed: [] }  // Error
          }
        }
        case 'error':
          onMessage(createChatErrorMessage(value.error, true))
          break
      }
      
      // If we got xml_tool_abort, break out to retry
      if (value.type === 'xml_tool_abort' && formatRetryCount <= MAX_FORMAT_RETRIES) {
        break
      }
    }
    
    // If we broke out due to xml_tool_abort, continue to next iteration
    if (!result && formatRetryCount > 0 && formatRetryCount <= MAX_FORMAT_RETRIES) {
      continue
    }
    
    if (!result) {
      onMessage(createChatDoneMessage(currentMessageId, 'error'))
      return { allPassed: false, failed: [] }  // Error
    }
    
    const { content, toolCalls, response, timing } = result
    
    // Track LLM metrics
    turnMetrics.addLLMCall(timing, response.usage.promptTokens, response.usage.completionTokens)
    
    // Update assistant message with final content
    sessionManager.updateMessage(sessionId, currentMessageId, {
      content,
      ...(toolCalls.length > 0 && { toolCalls }),
      tokenCount: response.usage.completionTokens,
      isStreaming: false,
    })
    
    // Add assistant message to verifier LLM context
    llmMessages.push({
      role: 'assistant',
      content,
      ...(toolCalls.length > 0 && { toolCalls }),
    })
    
    // Execute tool calls
    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        onMessage(createChatToolCallMessage(currentMessageId, toolCall.id, toolCall.name, toolCall.arguments))
        
        const result = await toolRegistry.execute(
          toolCall.name,
          toolCall.arguments,
          { workdir: session.workdir, sessionId }
        )
        
        // Track tool execution time
        turnMetrics.addToolTime(result.durationMs)
        
        onMessage(createChatToolResultMessage(currentMessageId, toolCall.id, toolCall.name, result))
        
        // Add tool result to verifier LLM context
        llmMessages.push({
          role: 'tool',
          content: result.success ? (result.output ?? 'Success') : `Error: ${result.error}`,
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
  
  // Check results and return
  session = sessionManager.requireSession(sessionId)
  const failed = session.criteria
    .filter(c => c.status.type === 'failed')
    .map(c => ({ 
      id: c.id, 
      reason: c.status.type === 'failed' ? c.status.reason : 'unknown' 
    }))
  
  // Send stats for the verifier sub-agent
  const stats = turnMetrics.buildStats(llmClient.getModel(), 'verifier')
  if (currentMessageId) {
    sessionManager.updateMessageStats(sessionId, currentMessageId, stats)
    onMessage(createChatDoneMessage(currentMessageId, 'complete', stats))
  }
  
  if (failed.length > 0) {
    logger.info('Verification failed', { sessionId, failed: failed.length })
    return { allPassed: false, failed }
  }
  
  // All passed!
  logger.info('All criteria verified', { sessionId })
  return { allPassed: true, failed: [] }
}

/**
 * Stream a summary response from the conversation
 * Uses same planner prompt to hit vLLM KV cache from conversation
 * The summary request prompt should already be added to session.messages by the caller
 */
export async function streamSummaryResponse(
  sessionId: string,
  llmClient: LLMClientWithModel,
  onMessage: (msg: ServerMessage) => void
): Promise<string> {
  const session = sessionManager.requireSession(sessionId)
  const turnMetrics = new TurnMetrics()
  
  // Use planner prompt to hit KV cache from conversation
  const toolRegistry = getToolRegistryForMode('planner')
  const systemPrompt = buildPlannerPrompt(toolRegistry.definitions)
  
  // Build messages from session (summary prompt already included)
  const llmMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...session.messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'tool',
      content: m.content,
      ...(m.toolCalls && { toolCalls: m.toolCalls }),
      ...(m.toolCallId && { toolCallId: m.toolCallId }),
    })),
  ]
  
  // Create assistant message for streaming
  const assistantMsg = sessionManager.addMessage(sessionId, {
    role: 'assistant',
    content: '',
    tokenCount: 0,
    isStreaming: true,
  })
  onMessage(createChatMessageMessage(assistantMsg))
  
  // Stream response (no tools for summary)
  const stream = streamWithSegments(llmClient, {
    messages: llmMessages,
  })
  
  let result: Awaited<ReturnType<typeof stream.next>>['value'] = null
  
  while (true) {
    const { value, done } = await stream.next()
    
    if (done) {
      result = value
      break
    }
    
    // Forward streaming events
    switch (value.type) {
      case 'text_delta':
        onMessage(createChatDeltaMessage(assistantMsg.id, value.content))
        break
      case 'thinking_delta':
        onMessage(createChatThinkingMessage(assistantMsg.id, value.content))
        break
      case 'error':
        onMessage(createChatErrorMessage(value.error, true))
        break
    }
  }
  
  if (!result) {
    sessionManager.updateMessage(sessionId, assistantMsg.id, { isStreaming: false })
    onMessage(createChatDoneMessage(assistantMsg.id, 'error'))
    throw new Error('Failed to generate summary')
  }
  
  const { content, thinkingContent, response, timing } = result
  
  // Track metrics
  turnMetrics.addLLMCall(timing, response.usage.promptTokens, response.usage.completionTokens)
  
  // Update assistant message with final content
  sessionManager.updateMessage(sessionId, assistantMsg.id, {
    content,
    ...(thinkingContent && { thinkingContent }),
    tokenCount: response.usage.completionTokens,
    isStreaming: false,
  })
  
  // Send done event with stats
  const stats = turnMetrics.buildStats(llmClient.getModel(), 'planner')
  sessionManager.updateMessageStats(sessionId, assistantMsg.id, stats)
  onMessage(createChatDoneMessage(assistantMsg.id, 'complete', stats))
  
  return content.trim()
}
