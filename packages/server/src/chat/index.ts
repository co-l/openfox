import type { Session, SessionMode, ToolCall, Todo } from '@openfox/shared'
import type { ServerMessage } from '@openfox/shared/protocol'
import type { LLMClientWithModel } from '../llm/client.js'
import { sessionManager } from '../session/index.js'
import { getToolRegistryForMode, setTodoUpdateCallback, AskUserInterrupt } from '../tools/index.js'
import { streamWithSegments, type StreamTiming } from '../llm/streaming.js'
import { buildPlannerPrompt, buildBuilderPrompt, buildVerifierPrompt, SUMMARY_GENERATION_PROMPT } from './prompts.js'
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
  createModeChangedMessage,
  createCriteriaUpdatedMessage,
  createSessionStateMessage,
} from '../ws/protocol.js'

export interface ChatOptions {
  sessionId: string
  llmClient: LLMClientWithModel
  signal?: AbortSignal
  onMessage: (msg: ServerMessage) => void
}

// Helper to build stats from timing
function buildStats(llmClient: LLMClientWithModel, timing: StreamTiming | null) {
  return timing ? {
    model: llmClient.getModel(),
    prefillSpeed: timing.prefillTps,
    generationSpeed: timing.tps,
  } : undefined
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
      case 'verifier':
        await runVerifierLoop(options)
        break
    }
  } catch (error) {
    if (error instanceof AskUserInterrupt) {
      // User intervention requested - pause execution
      onMessage(createChatDoneMessage('waiting_for_user'))
      return
    }
    
    logger.error('Chat error', { sessionId, mode, error })
    onMessage(createChatErrorMessage(
      error instanceof Error ? error.message : 'Unknown error',
      false
    ))
    onMessage(createChatDoneMessage('error'))
  } finally {
    sessionManager.setRunning(sessionId, false)
  }
}

/**
 * Planner mode: Single response to help define criteria
 * Returns timing from the last LLM call for stats
 */
async function runPlannerChat(options: ChatOptions): Promise<StreamTiming | null> {
  const { sessionId, llmClient, signal, onMessage } = options
  
  let session = sessionManager.requireSession(sessionId)
  const toolRegistry = getToolRegistryForMode('planner')
  
  const systemPrompt = buildPlannerPrompt(toolRegistry.definitions)
  
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...session.messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: m.content,
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
    })),
  ]
  
  // Stream response
  const stream = streamWithSegments(llmClient, {
    messages,
    tools: toolRegistry.definitions,
    toolChoice: 'auto',
  })
  
  let result: Awaited<ReturnType<typeof stream.next>>['value'] = null
  
  while (true) {
    if (signal?.aborted) {
      onMessage(createChatDoneMessage('stopped'))
      return null
    }
    
    const { value, done } = await stream.next()
    
    if (done) {
      result = value
      break
    }
    
    // Forward streaming events
    switch (value.type) {
      case 'text_delta':
        onMessage(createChatDeltaMessage(value.content))
        break
      case 'thinking_delta':
        onMessage(createChatThinkingMessage(value.content))
        break
      case 'error':
        onMessage(createChatErrorMessage(value.error, true))
        break
    }
  }
  
  if (!result) {
    onMessage(createChatDoneMessage('error'))
    return null
  }
  
  const { content, thinkingContent, toolCalls, response, segments, timing } = result
  
  // Save assistant message with stats
  sessionManager.addMessage(sessionId, {
    role: 'assistant',
    content,
    thinkingContent: thinkingContent || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    tokenCount: response.usage.completionTokens,
    segments,
    stats: buildStats(llmClient, timing),
  })
  
  // Execute any tool calls (planner has read + criteria tools)
  if (toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      onMessage(createChatToolCallMessage(toolCall.id, toolCall.name, toolCall.arguments))
      
      const result = await toolRegistry.execute(
        toolCall.name,
        toolCall.arguments,
        { workdir: session.workdir, sessionId }
      )
      
      onMessage(createChatToolResultMessage(toolCall.id, toolCall.name, result))
      
      // Save tool result
      sessionManager.addMessage(sessionId, {
        role: 'tool',
        content: result.success ? (result.output ?? 'Success') : `Error: ${result.error}`,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        toolResult: result,
        tokenCount: estimateTokens(result.output ?? result.error ?? ''),
      })
      
      // Check if criteria changed (planner can add/update/remove criteria)
      const updatedSession = sessionManager.requireSession(sessionId)
      if (JSON.stringify(updatedSession.criteria) !== JSON.stringify(session.criteria)) {
        onMessage(createCriteriaUpdatedMessage(updatedSession.criteria))
        session = updatedSession
      }
    }
    
    // Continue with another response if we had tool calls
    // Return the timing from the recursive call (most recent)
    return await runPlannerChat(options)
  }
  
  onMessage(createChatDoneMessage('complete', buildStats(llmClient, timing)))
  return timing
}

/**
 * Builder mode: Loop until all criteria completed or stuck
 * Returns timing from the last LLM call for stats
 */
async function runBuilderLoop(options: ChatOptions): Promise<StreamTiming | null> {
  const { sessionId, llmClient, signal, onMessage } = options
  
  let session = sessionManager.requireSession(sessionId)
  let iteration = 0
  const maxIterations = 50 // Safety limit
  let lastTiming: StreamTiming | null = null
  
  while (iteration < maxIterations) {
    if (signal?.aborted) {
      onMessage(createChatDoneMessage('stopped'))
      return null
    }
    
    iteration++
    session = sessionManager.requireSession(sessionId)
    
    // Check if all criteria are completed
    const allCompleted = session.criteria.every(c => 
      c.status.type === 'completed' || c.status.type === 'passed'
    )
    
    if (allCompleted && session.criteria.length > 0) {
      logger.info('All criteria completed, switching to verifier', { sessionId })
      
      // Switch to verifier mode
      sessionManager.setMode(sessionId, 'verifier')
      onMessage(createModeChangedMessage('verifier', true, 'All criteria completed'))
      
      // Run verifier (it will send its own done message)
      return await runVerifierLoop(options)
    }
    
    const toolRegistry = getToolRegistryForMode('builder')
    const systemPrompt = buildBuilderPrompt(
      session.criteria,
      toolRegistry.definitions,
      session.executionState?.modifiedFiles ?? []
    )
    
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...session.messages
        .filter(m => !m.isCompacted || m.role === 'system')
        .map(m => ({
          role: m.role as 'user' | 'assistant' | 'system' | 'tool',
          content: m.role === 'tool' && m.toolResult
            ? (m.toolResult.success ? (m.toolResult.output ?? 'Success') : `Error: ${m.toolResult.error}`)
            : m.content,
          toolCalls: m.toolCalls,
          toolCallId: m.toolCallId,
        })),
    ]
    
    // Stream response
    const stream = streamWithSegments(llmClient, {
      messages,
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
    })
    
    let result: Awaited<ReturnType<typeof stream.next>>['value'] = null
    
    while (true) {
      if (signal?.aborted) {
        onMessage(createChatDoneMessage('stopped'))
        return null
      }
      
      const { value, done } = await stream.next()
      
      if (done) {
        result = value
        break
      }
      
      switch (value.type) {
        case 'text_delta':
          onMessage(createChatDeltaMessage(value.content))
          break
        case 'thinking_delta':
          onMessage(createChatThinkingMessage(value.content))
          break
        case 'error':
          onMessage(createChatErrorMessage(value.error, true))
          break
      }
    }
    
    if (!result) {
      onMessage(createChatDoneMessage('error'))
      return null
    }
    
    const { content, thinkingContent, toolCalls, response, segments, timing } = result
    lastTiming = timing
    
    // Save assistant message with stats
    sessionManager.addMessage(sessionId, {
      role: 'assistant',
      content,
      thinkingContent: thinkingContent || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      tokenCount: response.usage.completionTokens,
      segments,
      stats: buildStats(llmClient, timing),
    })
    
    // Execute tool calls
    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        if (signal?.aborted) {
          onMessage(createChatDoneMessage('stopped'))
          return null
        }
        
        onMessage(createChatToolCallMessage(toolCall.id, toolCall.name, toolCall.arguments))
        
        const result = await toolRegistry.execute(
          toolCall.name,
          toolCall.arguments,
          { workdir: session.workdir, sessionId }
        )
        
        onMessage(createChatToolResultMessage(toolCall.id, toolCall.name, result))
        
        // Save tool result
        sessionManager.addMessage(sessionId, {
          role: 'tool',
          content: result.success ? (result.output ?? 'Success') : `Error: ${result.error}`,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolResult: result,
          tokenCount: estimateTokens(result.output ?? result.error ?? ''),
        })
        
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
      
      // Continue loop
      continue
    }
    
    // No tool calls - model is done for now
    // Check if we should auto-continue
    const pendingCriteria = session.criteria.filter(c => 
      c.status.type === 'pending' || c.status.type === 'in_progress'
    )
    
    if (pendingCriteria.length > 0) {
      // Add a nudge message
      sessionManager.addMessage(sessionId, {
        role: 'user',
        content: `Continue working on the remaining criteria. ${pendingCriteria.length} criteria still pending.`,
        tokenCount: 20,
      })
      continue
    }
    
    break
  }
  
  onMessage(createChatDoneMessage('complete', buildStats(llmClient, lastTiming)))
  return lastTiming
}

/**
 * Verifier mode: Check all completed criteria
 * Returns timing from the last LLM call for stats
 */
async function runVerifierLoop(options: ChatOptions): Promise<StreamTiming | null> {
  const { sessionId, llmClient, signal, onMessage } = options
  
  let session = sessionManager.requireSession(sessionId)
  let lastTiming: StreamTiming | null = null
  
  // Check if there's anything to verify
  const toVerify = session.criteria.filter(c => c.status.type === 'completed')
  if (toVerify.length === 0) {
    logger.info('Nothing to verify', { sessionId })
    onMessage(createChatDoneMessage('complete'))
    return null
  }
  
  const toolRegistry = getToolRegistryForMode('verifier')
  const systemPrompt = buildVerifierPrompt(
    session.criteria,
    toolRegistry.definitions,
    session.summary ?? 'No summary available',
    session.executionState?.modifiedFiles ?? []
  )
  
  // Verifier gets fresh context (only system prompt with summary)
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: 'Please verify each criterion marked [NEEDS VERIFICATION].' },
  ]
  
  let iteration = 0
  const maxIterations = 20
  
  while (iteration < maxIterations) {
    if (signal?.aborted) {
      onMessage(createChatDoneMessage('stopped'))
      return null
    }
    
    iteration++
    
    const stream = streamWithSegments(llmClient, {
      messages,
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
    })
    
    let result: Awaited<ReturnType<typeof stream.next>>['value'] = null
    
    while (true) {
      if (signal?.aborted) {
        onMessage(createChatDoneMessage('stopped'))
        return null
      }
      
      const { value, done } = await stream.next()
      
      if (done) {
        result = value
        break
      }
      
      switch (value.type) {
        case 'text_delta':
          onMessage(createChatDeltaMessage(value.content))
          break
        case 'thinking_delta':
          onMessage(createChatThinkingMessage(value.content))
          break
        case 'error':
          onMessage(createChatErrorMessage(value.error, true))
          break
      }
    }
    
    if (!result) {
      onMessage(createChatDoneMessage('error'))
      return null
    }
    
    const { content, toolCalls, timing } = result
    lastTiming = timing
    
    // Add assistant message to verifier context
    messages.push({
      role: 'assistant' as const,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    } as any)
    
    // Execute tool calls
    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        onMessage(createChatToolCallMessage(toolCall.id, toolCall.name, toolCall.arguments))
        
        const result = await toolRegistry.execute(
          toolCall.name,
          toolCall.arguments,
          { workdir: session.workdir, sessionId }
        )
        
        onMessage(createChatToolResultMessage(toolCall.id, toolCall.name, result))
        
        // Add tool result to verifier context
        messages.push({
          role: 'tool' as const,
          content: result.success ? (result.output ?? 'Success') : `Error: ${result.error}`,
          toolCallId: toolCall.id,
        } as any)
        
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
  const failed = session.criteria.filter(c => c.status.type === 'failed')
  
  if (failed.length > 0) {
    logger.info('Verification failed, returning to builder', { sessionId, failed: failed.length })
    
    // Add failure context to main session messages
    sessionManager.addMessage(sessionId, {
      role: 'system',
      content: `Verification found ${failed.length} failing criteria:\n${failed.map(c => `- ${c.id}: ${c.status.type === 'failed' ? c.status.reason : 'unknown'}`).join('\n')}`,
      tokenCount: 50,
    })
    
    // Switch back to builder
    sessionManager.setMode(sessionId, 'builder')
    onMessage(createModeChangedMessage('builder', true, `${failed.length} criteria failed verification`))
    
    // Continue building (it will send its own done message)
    return await runBuilderLoop(options)
  }
  
  // All passed!
  logger.info('All criteria verified', { sessionId })
  onMessage(createChatDoneMessage('complete', buildStats(llmClient, lastTiming)))
  return lastTiming
}

/**
 * Generate a summary from the conversation
 */
export async function generateSummary(
  sessionId: string,
  llmClient: LLMClient
): Promise<string> {
  const session = sessionManager.requireSession(sessionId)
  
  const conversationText = session.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-20) // Last 20 messages
    .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
    .join('\n\n')
  
  const criteriaText = session.criteria
    .map(c => `- ${c.id}: ${c.description}`)
    .join('\n')
  
  const response = await llmClient.complete({
    messages: [
      { role: 'system', content: SUMMARY_GENERATION_PROMPT },
      { role: 'user', content: `Conversation:\n${conversationText}\n\nAcceptance Criteria:\n${criteriaText}` },
    ],
  })
  
  return response.content.trim()
}
