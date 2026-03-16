/**
 * Builder Worker
 * 
 * Executes the builder loop: LLM call + tool execution until the model
 * naturally stops (returns no tool calls). This is the standard agent loop.
 */

import type { ToolCall, PromptContext, InjectedFile } from '@openfox/shared'
import type { ServerMessage } from '@openfox/shared/protocol'
import type { LLMClientWithModel } from '../llm/client.js'
import type { StepResult } from '../runner/types.js'
import { sessionManager } from '../session/index.js'
import { getToolRegistryForMode } from '../tools/index.js'
import { buildBuilderPrompt, BUILDER_KICKOFF_PROMPT } from './prompts.js'
import { streamLLMResponse } from './stream.js'
import { computeMessageStats } from './stats.js'
import { estimateTokens } from '../context/tokenizer.js'
import { getAllInstructions } from '../context/instructions.js'
import {
  createChatToolCallMessage,
  createChatToolResultMessage,
  createChatMessageMessage,
  createChatDoneMessage,
  createCriteriaUpdatedMessage,
} from '../ws/protocol.js'
import { createToolProgressHandler } from './tool-streaming.js'

export interface BuilderStepOptions {
  sessionId: string
  llmClient: LLMClientWithModel
  signal?: AbortSignal
  onMessage: (msg: ServerMessage) => void
}

/**
 * Execute the builder loop: LLM calls + tool execution until natural stop.
 * 
 * The model "naturally stops" when it returns a response without tool calls.
 * This is the standard agent loop pattern - we don't interrupt the model
 * between tool executions.
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
  
  // Track cumulative stats across the entire agent loop
  let totalToolTime = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let lastMessageId = ''
  let lastContent = ''
  let lastTiming: StepResult['timing'] | null = null
  let madeAnyToolCalls = false
  
  // Agent loop: keep calling LLM until it returns no tool calls
  while (true) {
    if (signal?.aborted) {
      throw new Error('Aborted')
    }
    
    // Refresh session state and rebuild system prompt each iteration
    // (criteria status may have changed, user may have edited instructions)
    session = sessionManager.requireSession(sessionId)
    const { content: instructions, files: instructionFiles } = await getAllInstructions(session.workdir, session.projectId)
    
    const systemPrompt = buildBuilderPrompt(
      session.criteria,
      toolRegistry.definitions,
      session.executionState?.modifiedFiles ?? [],
      instructions || undefined
    )
    
    // Attach prompt context to the last user message (for debugging/inspection)
    const currentWindowMessages = sessionManager.getCurrentWindowMessages(sessionId)
    const lastUserMessage = [...currentWindowMessages].reverse().find(m => m.role === 'user')
    
    if (lastUserMessage && !madeAnyToolCalls) {
      // Only attach on first iteration, not after tool results
      const promptContext: PromptContext = {
        systemPrompt,
        injectedFiles: instructionFiles.map(f => ({ path: f.path, content: f.content ?? '', source: f.source })) as InjectedFile[],
        userMessage: lastUserMessage.content,
      }
      sessionManager.updateMessage(sessionId, lastUserMessage.id, { promptContext })
    }
    
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
    
    // Track cumulative usage
    totalPromptTokens += result.usage.promptTokens
    totalCompletionTokens += result.usage.completionTokens
    lastMessageId = result.messageId
    lastContent = result.content
    lastTiming = result.timing
    
    // If no tool calls, model has naturally stopped - exit loop
    if (result.toolCalls.length === 0) {
      // Send final stats for this message
      const stats = computeMessageStats({
        model: llmClient.getModel(),
        mode: 'builder',
        timing: result.timing,
        usage: result.usage,
        toolTime: 0,
        totalTimeOverride: (performance.now() - startTime) / 1000,
      })
      sessionManager.updateMessageStats(sessionId, result.messageId, stats)
      onMessage(createChatDoneMessage(result.messageId, 'complete', stats))
      break
    }
    
    // Execute tool calls
    madeAnyToolCalls = true
    let iterationToolTime = 0
    
    for (const toolCall of result.toolCalls) {
      if (signal?.aborted) {
        onMessage(createChatDoneMessage(result.messageId, 'stopped'))
        throw new Error('Aborted')
      }
      
      onMessage(createChatToolCallMessage(result.messageId, toolCall.id, toolCall.name, toolCall.arguments))
      
      // Create progress handler for streaming output (run_command only)
      const onProgress = createToolProgressHandler(result.messageId, toolCall.id, onMessage)
      
      const toolResult = await toolRegistry.execute(
        toolCall.name,
        toolCall.arguments,
        { workdir: session.workdir, sessionId, lspManager: sessionManager.getLspManager(sessionId), onEvent: onMessage, onProgress }
      )
      
      iterationToolTime += toolResult.durationMs
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
    
    // Update stats for this iteration's message (with tool time)
    const iterationStats = computeMessageStats({
      model: llmClient.getModel(),
      mode: 'builder',
      timing: result.timing,
      usage: result.usage,
      toolTime: iterationToolTime / 1000,
    })
    sessionManager.updateMessageStats(sessionId, result.messageId, iterationStats)
    onMessage(createChatDoneMessage(result.messageId, 'complete', iterationStats))
    
    // Loop continues - model will see tool results and decide what to do next
  }
  
  return {
    messageId: lastMessageId,
    hasToolCalls: madeAnyToolCalls,
    content: lastContent,
    timing: lastTiming!,
    usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
  }
}
