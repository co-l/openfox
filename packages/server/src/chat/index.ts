import type { Session, SessionMode, ToolMode, ToolCall, Todo, MessageStats, Message } from '@openfox/shared'
import type { ServerMessage } from '@openfox/shared/protocol'
import type { LLMClientWithModel } from '../llm/client.js'
import type { StreamTiming } from '../llm/streaming.js'
import { sessionManager } from '../session/index.js'
import { getToolRegistryForMode, setTodoUpdateCallback, AskUserInterrupt } from '../tools/index.js'
import { buildPlannerPrompt, buildBuilderPrompt, buildVerifierPrompt, BUILDER_KICKOFF_PROMPT, VERIFIER_KICKOFF_PROMPT } from './prompts.js'
import { streamLLMResponse } from './stream.js'
import { estimateTokens } from '../context/tokenizer.js'
import { logger } from '../utils/logger.js'
import {
  createChatToolCallMessage,
  createChatToolResultMessage,
  createChatTodoMessage,
  createChatSummaryMessage,
  createChatDoneMessage,
  createChatErrorMessage,
  createChatMessageMessage,
  createModeChangedMessage,
  createPhaseChangedMessage,
  createCriteriaUpdatedMessage,
} from '../ws/protocol.js'

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
 * Planner mode: Streaming chat with tool support
 * Uses TurnMetrics to track aggregated metrics across recursive calls
 * Uses core streamLLMResponse for LLM interaction.
 */
async function runPlannerChat(
  options: ChatOptions, 
  metrics?: TurnMetrics
): Promise<void> {
  const { sessionId, llmClient, signal, onMessage } = options
  const turnMetrics = metrics ?? new TurnMetrics()
  
  let session = sessionManager.requireSession(sessionId)
  
  const toolRegistry = getToolRegistryForMode('planner')
  const systemPrompt = buildPlannerPrompt(toolRegistry.definitions)
  
  // Stream LLM response using core function (handles XML retry internally)
  const result = await streamLLMResponse({
    sessionId,
    systemPrompt,
    llmClient,
    tools: toolRegistry.definitions,
    toolChoice: 'auto',
    signal,
    onEvent: onMessage,
  })
  
  // Track LLM metrics
  turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
  
  // Execute any tool calls (planner has read + criteria tools)
  if (result.toolCalls.length > 0) {
    for (const toolCall of result.toolCalls) {
      onMessage(createChatToolCallMessage(result.messageId, toolCall.id, toolCall.name, toolCall.arguments))
      
      const toolResult = await toolRegistry.execute(
        toolCall.name,
        toolCall.arguments,
        { workdir: session.workdir, sessionId }
      )
      
      // Track tool execution time
      turnMetrics.addToolTime(toolResult.durationMs)
      
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
      
      // Check if criteria changed (planner can add/update/remove criteria)
      const updatedSession = sessionManager.requireSession(sessionId)
      if (JSON.stringify(updatedSession.criteria) !== JSON.stringify(session.criteria)) {
        onMessage(createCriteriaUpdatedMessage(updatedSession.criteria))
        session = updatedSession
      }
    }
    
    // Continue with another response if we had tool calls
    // Pass metrics through to accumulate across recursive calls
    return await runPlannerChat(options, turnMetrics)
  }
  
  // Final response - build aggregated stats
  const stats = turnMetrics.buildStats(llmClient.getModel(), 'planner')
  
  // Update the message with stats
  sessionManager.updateMessageStats(sessionId, result.messageId, stats)
  
  onMessage(createChatDoneMessage(result.messageId, 'complete', stats))
}

/**
 * Builder mode: Loop until all criteria completed or stuck
 * Uses TurnMetrics to track aggregated metrics across the turn
 * Uses core streamLLMResponse for LLM interaction.
 */
async function runBuilderLoop(options: ChatOptions): Promise<void> {
  const { sessionId, llmClient, signal, onMessage } = options
  const turnMetrics = new TurnMetrics()
  
  let session = sessionManager.requireSession(sessionId)
  let iteration = 0
  const maxIterations = 50 // Safety limit
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
    session = sessionManager.requireSession(sessionId)
  }
  
  while (iteration < maxIterations) {
    if (signal?.aborted) {
      if (currentMessageId) {
        onMessage(createChatDoneMessage(currentMessageId, 'stopped'))
      }
      return
    }
    
    iteration++
    session = sessionManager.requireSession(sessionId)
    
    // Check if all criteria are completed (awaiting verification)
    const needsVerification = session.criteria.some(c => c.status.type === 'completed')
    const allCompletedOrPassed = session.criteria.every(c => 
      c.status.type === 'completed' || c.status.type === 'passed'
    )
    
    if (needsVerification && allCompletedOrPassed && session.criteria.length > 0) {
      logger.info('All criteria completed, running verification sub-agent', { sessionId })
      
      // Send stats for builder turn before verification
      if (currentMessageId) {
        const stats = turnMetrics.buildStats(llmClient.getModel(), 'builder')
        sessionManager.updateMessageStats(sessionId, currentMessageId, stats)
        onMessage(createChatDoneMessage(currentMessageId, 'complete', stats))
      }
      
      // Set phase to verification
      sessionManager.setPhase(sessionId, 'verification')
      onMessage(createPhaseChangedMessage('verification'))
      
      // Run verification as inline sub-agent
      const verificationResult = await runVerificationSubAgent(options)
      
      if (verificationResult.allPassed) {
        logger.info('All criteria verified successfully', { sessionId })
        sessionManager.setPhase(sessionId, 'done')
        onMessage(createPhaseChangedMessage('done'))
        return
      }
      
      // Verification failed - check if any criterion has hit max attempts
      session = sessionManager.requireSession(sessionId)
      const MAX_VERIFICATION_ATTEMPTS = 4
      const blockedCriteria = session.criteria.filter(c => 
        c.status.type === 'failed' && 
        c.attempts.filter(a => a.status === 'failed').length >= MAX_VERIFICATION_ATTEMPTS
      )
      
      if (blockedCriteria.length > 0) {
        logger.info('Verification retry limit reached, blocking', { 
          sessionId, 
          blockedCriteria: blockedCriteria.map(c => c.id) 
        })
        sessionManager.setPhase(sessionId, 'blocked')
        onMessage(createPhaseChangedMessage('blocked'))
        
        const blockedMsg = sessionManager.addMessage(sessionId, {
          role: 'user',
          content: `Verification failed ${MAX_VERIFICATION_ATTEMPTS} times for: ${blockedCriteria.map(c => c.id).join(', ')}. Please review and decide how to proceed.`,
          tokenCount: 30,
          isSystemGenerated: true,
          messageKind: 'correction',
        })
        onMessage(createChatMessageMessage(blockedMsg))
        return
      }
      
      // Under retry limit - inject failure context and continue builder loop
      logger.info('Verification failed, continuing builder', { sessionId, failed: verificationResult.failed.length })
      
      sessionManager.setPhase(sessionId, 'build')
      onMessage(createPhaseChangedMessage('build'))
      
      const failureMsg = sessionManager.addMessage(sessionId, {
        role: 'user',
        content: `Verification found ${verificationResult.failed.length} failing criteria:\n${verificationResult.failed.map(f => `- ${f.id}: ${f.reason}`).join('\n')}`,
        tokenCount: 50,
        isSystemGenerated: true,
        messageKind: 'correction',
      })
      onMessage(createChatMessageMessage(failureMsg))
      
      continue
    }
    
    const toolRegistry = getToolRegistryForMode('builder')
    const systemPrompt = buildBuilderPrompt(
      session.criteria,
      toolRegistry.definitions,
      session.executionState?.modifiedFiles ?? []
    )
    
    // Stream LLM response using core function (handles XML retry internally)
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
      // Aborted or error - already handled by streamLLMResponse
      return
    }
    
    currentMessageId = result.messageId
    
    // Track LLM metrics
    turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
    
    // Execute tool calls
    if (result.toolCalls.length > 0) {
      for (const toolCall of result.toolCalls) {
        if (signal?.aborted) {
          onMessage(createChatDoneMessage(currentMessageId, 'stopped'))
          return
        }
        
        onMessage(createChatToolCallMessage(currentMessageId, toolCall.id, toolCall.name, toolCall.arguments))
        
        const toolResult = await toolRegistry.execute(
          toolCall.name,
          toolCall.arguments,
          { workdir: session.workdir, sessionId }
        )
        
        turnMetrics.addToolTime(toolResult.durationMs)
        
        onMessage(createChatToolResultMessage(currentMessageId, toolCall.id, toolCall.name, toolResult))
        
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
        }
      }
      
      continue
    }
    
    // No tool calls - check if we should auto-continue
    const pendingCriteria = session.criteria.filter(c => 
      c.status.type === 'pending' || c.status.type === 'in_progress'
    )
    
    if (pendingCriteria.length > 0) {
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
 * Uses core streamLLMResponse with customMessages for fresh context.
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
  const systemPrompt = buildVerifierPrompt(toolRegistry.definitions)
  
  // Verifier uses fresh context - track separately from session
  const customMessages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; toolCalls?: ToolCall[]; toolCallId?: string }> = [
    { role: 'user', content: contextContent },
    { role: 'user', content: VERIFIER_KICKOFF_PROMPT },
  ]
  
  let iteration = 0
  const maxIterations = 20
  let currentMessageId: string | undefined
  
  while (iteration < maxIterations) {
    if (signal?.aborted) {
      if (currentMessageId) {
        onMessage(createChatDoneMessage(currentMessageId, 'stopped'))
      }
      return { allPassed: false, failed: [] }
    }
    
    iteration++
    
    // Stream LLM response with fresh context (handles XML retry internally)
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
      })
    } catch (error) {
      // Aborted or error - already handled by streamLLMResponse
      return { allPassed: false, failed: [] }
    }
    
    currentMessageId = result.messageId
    
    // Track LLM metrics
    turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
    
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
        
        turnMetrics.addToolTime(toolResult.durationMs)
        
        onMessage(createChatToolResultMessage(currentMessageId, toolCall.id, toolCall.name, toolResult))
        
        // Add tool result to custom context (NOT to session - verifier uses fresh context)
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
