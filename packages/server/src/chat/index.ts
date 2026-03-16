import type { Session, SessionMode, ToolMode, ToolCall, Todo, MessageStats, Message, PromptContext, InjectedFile } from '@openfox/shared'
import type { ServerMessage } from '@openfox/shared/protocol'
import type { LLMClientWithModel } from '../llm/client.js'
import type { StreamTiming } from '../llm/streaming.js'
import { sessionManager } from '../session/index.js'
import {
  getToolRegistryForMode,
  setTodoUpdateCallback,
  AskUserInterrupt,
  PathAccessDeniedError,
} from '../tools/index.js'
import { buildPlannerPrompt, buildBuilderPrompt } from './prompts.js'
import { streamLLMResponse } from './stream.js'
import { computeAggregatedStats } from './stats.js'
import { estimateTokens } from '../context/tokenizer.js'
import { getAllInstructions } from '../context/instructions.js'
import { logger } from '../utils/logger.js'
import {
  createChatToolCallMessage,
  createChatToolResultMessage,
  createChatTodoMessage,
  createChatDoneMessage,
  createChatErrorMessage,
  createChatMessageMessage,
  createCriteriaUpdatedMessage,
} from '../ws/protocol.js'
import { createToolProgressHandler } from './tool-streaming.js'

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
    return computeAggregatedStats({
      model,
      mode,
      totalPrefillTokens: this.totalPrefillTokens,
      totalGenTokens: this.totalGenTokens,
      totalPrefillTime: this.totalPrefillTime,
      totalGenTime: this.totalGenTime,
      totalToolTime: this.totalToolTime,
      totalTime: (performance.now() - this.startTime) / 1000,
    })
  }
}

/**
 * Handle a chat interaction in the current mode.
 * This is single-turn chat - used by the "Send" button.
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
        await runBuilderTurn(options)
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
    
    if (error instanceof PathAccessDeniedError) {
      // User denied path access - abort with clear error
      logger.warn('Path access denied by user', {
        sessionId,
        tool: error.tool,
        paths: error.paths,
      })
      onMessage(createChatErrorMessage(
        `Execution aborted: Access denied to paths outside workdir:\n${error.paths.join('\n')}`,
        false  // not recoverable
      ))
      const errorMsg = sessionManager.addMessage(sessionId, {
        role: 'user',
        content: `Access denied to: ${error.paths.join(', ')}`,
        tokenCount: 10,
        isSystemGenerated: true,
        messageKind: 'correction',
      })
      onMessage(createChatMessageMessage(errorMsg))
      onMessage(createChatDoneMessage(errorMsg.id, 'error'))
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
 * Planner mode: Streaming chat with tool support.
 * Uses TurnMetrics to track aggregated metrics across recursive calls.
 */
async function runPlannerChat(
  options: ChatOptions, 
  metrics?: TurnMetrics,
  cachedInstructionData?: { content: string; files: InjectedFile[] }
): Promise<void> {
  const { sessionId, llmClient, signal, onMessage } = options
  const turnMetrics = metrics ?? new TurnMetrics()
  
  let session = sessionManager.requireSession(sessionId)
  
  // Load all instructions (re-read each turn so user can edit mid-session)
  const instructionData = cachedInstructionData ?? await (async () => {
    const { content, files } = await getAllInstructions(session.workdir, session.projectId)
    return {
      content,
      files: files.map(f => ({ path: f.path, content: f.content ?? '', source: f.source })) as InjectedFile[],
    }
  })()
  
  const toolRegistry = getToolRegistryForMode('planner')
  const systemPrompt = buildPlannerPrompt(toolRegistry.definitions, instructionData.content || undefined)
  
  // Get the user message that triggered this response (last user message)
  const currentWindowMessages = sessionManager.getCurrentWindowMessages(sessionId)
  const lastUserMessage = [...currentWindowMessages].reverse().find(m => m.role === 'user')
  
  // Build prompt context and attach to user message (only on first call, not recursive)
  if (!metrics && lastUserMessage) {
    const promptContext: PromptContext = {
      systemPrompt,
      injectedFiles: instructionData.files,
      userMessage: lastUserMessage.content,
    }
    sessionManager.updateMessage(sessionId, lastUserMessage.id, { promptContext })
  }
  
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
      
      // Create progress handler for streaming output (run_command only)
      const onProgress = createToolProgressHandler(result.messageId, toolCall.id, onMessage)
      
      const toolResult = await toolRegistry.execute(
        toolCall.name,
        toolCall.arguments,
        { workdir: session.workdir, sessionId, signal, lspManager: sessionManager.getLspManager(sessionId), onEvent: onMessage, onProgress }
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
    // Pass metrics and instructions through to accumulate across recursive calls
    return await runPlannerChat(options, turnMetrics, instructionData)
  }
  
  // Final response - build aggregated stats
  const stats = turnMetrics.buildStats(llmClient.getModel(), 'planner')
  
  // Update the message with stats
  sessionManager.updateMessageStats(sessionId, result.messageId, stats)
  
  onMessage(createChatDoneMessage(result.messageId, 'complete', stats))
}

/**
 * Builder mode: Single-turn chat with tool support.
 * Used by "Send" button - just responds to user message, no verification or auto-loop.
 * Uses TurnMetrics to track aggregated metrics across recursive calls.
 */
async function runBuilderTurn(
  options: ChatOptions,
  metrics?: TurnMetrics,
  cachedInstructionData?: { content: string; files: InjectedFile[] }
): Promise<void> {
  const { sessionId, llmClient, signal, onMessage } = options
  const turnMetrics = metrics ?? new TurnMetrics()
  
  let session = sessionManager.requireSession(sessionId)
  
  // Load all instructions (re-read each turn so user can edit mid-session)
  const instructionData = cachedInstructionData ?? await (async () => {
    const { content, files } = await getAllInstructions(session.workdir, session.projectId)
    return {
      content,
      files: files.map(f => ({ path: f.path, content: f.content ?? '', source: f.source })) as InjectedFile[],
    }
  })()
  
  const toolRegistry = getToolRegistryForMode('builder')
  const systemPrompt = buildBuilderPrompt(
    session.criteria,
    toolRegistry.definitions,
    session.executionState?.modifiedFiles ?? [],
    instructionData.content || undefined
  )
  
  // Get the user message that triggered this response
  const currentWindowMessages = sessionManager.getCurrentWindowMessages(sessionId)
  const lastUserMessage = [...currentWindowMessages].reverse().find(m => m.role === 'user')
  
  // Build prompt context and attach to user message (only on first call, not recursive)
  if (!metrics && lastUserMessage) {
    const promptContext: PromptContext = {
      systemPrompt,
      injectedFiles: instructionData.files,
      userMessage: lastUserMessage.content,
    }
    sessionManager.updateMessage(sessionId, lastUserMessage.id, { promptContext })
  }
  
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
  
  // Execute any tool calls
  if (result.toolCalls.length > 0) {
    for (const toolCall of result.toolCalls) {
      onMessage(createChatToolCallMessage(result.messageId, toolCall.id, toolCall.name, toolCall.arguments))
      
      // Create progress handler for streaming output (run_command only)
      const onProgress = createToolProgressHandler(result.messageId, toolCall.id, onMessage)
      
      const toolResult = await toolRegistry.execute(
        toolCall.name,
        toolCall.arguments,
        { workdir: session.workdir, sessionId, signal, lspManager: sessionManager.getLspManager(sessionId), onEvent: onMessage, onProgress }
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
    
    // Continue with another response if we had tool calls
    // Pass metrics and instructions through to accumulate across recursive calls
    return await runBuilderTurn(options, turnMetrics, instructionData)
  }
  
  // Final response - build aggregated stats
  const stats = turnMetrics.buildStats(llmClient.getModel(), 'builder')
  
  // Update the message with stats
  sessionManager.updateMessageStats(sessionId, result.messageId, stats)
  
  onMessage(createChatDoneMessage(result.messageId, 'complete', stats))
}
