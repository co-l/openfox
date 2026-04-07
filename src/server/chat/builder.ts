/**
 * Builder Worker
 * 
 * Executes the builder loop: LLM call + tool execution until the model
 * naturally stops (returns no tool calls). This is the standard agent loop.
 */

import type { Attachment, ToolCall } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { StepResult } from '../runner/types.js'

const getStatsIdentity = (model: string) => ({
  providerId: `provider:${model}`,
  providerName: 'Unknown Provider',
  backend: 'unknown' as const,
  model,
})
import type { SessionManager } from '../session/index.js'
import { getToolRegistryForAgent } from '../tools/index.js'
import { BUILDER_KICKOFF_PROMPT } from './prompts.js'
import { streamLLMResponse } from './stream.js'
import { computeAggregatedStats } from './stats.js'
import { getAllInstructions } from '../context/instructions.js'
import { assembleAgentRequest, type RequestContextMessage } from './request-context.js'
import { loadAllAgentsDefault, findAgentById, getSubAgents } from '../agents/registry.js'
import {
  createChatToolCallMessage,
  createChatToolResultMessage,
  createChatMessageMessage,
  createChatDoneMessage,
  createCriteriaUpdatedMessage,
} from '../ws/protocol.js'
import { createToolProgressHandler } from './tool-streaming.js'

export interface BuilderStepOptions {
  sessionManager: SessionManager
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
  const { sessionManager, sessionId, llmClient, signal, onMessage } = options
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
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
    })
    onMessage(createChatMessageMessage(kickoffMsg))
    session = sessionManager.requireSession(sessionId)
  }
  
  const allAgents = await loadAllAgentsDefault()
  const builderDef = findAgentById('builder', allAgents)!
  const subAgentDefs = getSubAgents(allAgents)
  const toolRegistry = getToolRegistryForAgent(builderDef)

  // Track cumulative stats across the entire agent loop
  let totalToolTime = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let totalPrefillTime = 0
  let totalGenTime = 0
  let lastMessageId = ''
  let lastContent = ''
  let lastTiming: StepResult['timing'] | null = null
  let madeAnyToolCalls = false
  
  // Agent loop: keep calling LLM until it returns no tool calls
  while (true) {
    if (signal?.aborted) {
      // Emit partial stats before aborting
      const stats = computeAggregatedStats({
        identity: getStatsIdentity(llmClient.getModel()),
        mode: 'builder',
        totalPrefillTokens: totalPromptTokens,
        totalGenTokens: totalCompletionTokens,
        totalPrefillTime,
        totalGenTime,
        totalToolTime: totalToolTime / 1000,
        totalTime: (performance.now() - startTime) / 1000,
      })
      if (lastMessageId) {
        sessionManager.updateMessageStats(sessionId, lastMessageId, stats)
        onMessage(createChatDoneMessage(lastMessageId, 'stopped', stats))
      }
      throw new Error('Aborted')
    }
    
    // Refresh session state and rebuild system prompt each iteration
    // (criteria status may have changed, user may have edited instructions)
    session = sessionManager.requireSession(sessionId)
    const { content: instructions, files: instructionFiles } = await getAllInstructions(session.workdir, session.projectId)
    
    const currentWindowMessages = sessionManager.getCurrentWindowMessages(sessionId)
    const requestMessages: RequestContextMessage[] = currentWindowMessages.map(message => ({
      role: message.role as 'user' | 'assistant' | 'tool',
      content: message.content,
      source: message.messageKind === 'auto-prompt' ? 'runtime' : 'history',
      ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(message.attachments ? { attachments: message.attachments } : {}),
    }))
    const assembledRequest = assembleAgentRequest({
      agentDef: builderDef,
      subAgentDefs,
      workdir: session.workdir,
      messages: requestMessages,
      injectedFiles: instructionFiles.map(file => ({ path: file.path, content: file.content ?? '', source: file.source })),
      promptTools: toolRegistry.definitions,
      toolChoice: 'auto',
      ...(instructions ? { customInstructions: instructions } : {}),
    })
    const systemPrompt = assembledRequest.systemPrompt

    // Attach prompt context to the last user message (for debugging/inspection)
    const lastUserMessage = [...currentWindowMessages].reverse().find(m => m.role === 'user')
    
    if (lastUserMessage && !madeAnyToolCalls) {
      sessionManager.updateMessage(sessionId, lastUserMessage.id, { promptContext: assembledRequest.promptContext })
    }
    
    // Stream LLM response
    let result
    try {
      result = await streamLLMResponse({
        sessionManager,
        sessionId,
        systemPrompt,
        llmClient,
        tools: toolRegistry.definitions,
        toolChoice: 'auto',
        signal,
        onEvent: onMessage,
        customMessages: assembledRequest.messages,
      })
    } catch (error) {
      // Aborted or error - rethrow for orchestrator to handle
      throw error
    }
    
    // Track cumulative usage and timing
    totalPromptTokens += result.usage.promptTokens
    totalCompletionTokens += result.usage.completionTokens
    totalPrefillTime += result.timing.ttft
    totalGenTime += result.timing.completionTime
    lastMessageId = result.messageId
    lastContent = result.content
    lastTiming = result.timing
    
    // If no tool calls, model has naturally stopped - exit loop
    // Emit stats for this builder step (PROMPT -> WORK -> stats+sound pattern)
    if (result.toolCalls.length === 0) {
      const stats = computeAggregatedStats({
        identity: getStatsIdentity(llmClient.getModel()),
        mode: 'builder',
        totalPrefillTokens: totalPromptTokens,
        totalGenTokens: totalCompletionTokens,
        totalPrefillTime,
        totalGenTime,
        totalToolTime: totalToolTime / 1000,
        totalTime: (performance.now() - startTime) / 1000,
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
        // Emit partial stats before aborting
        const stats = computeAggregatedStats({
          identity: getStatsIdentity(llmClient.getModel()),
          mode: 'builder',
          totalPrefillTokens: totalPromptTokens,
          totalGenTokens: totalCompletionTokens,
          totalPrefillTime,
          totalGenTime,
          totalToolTime: totalToolTime / 1000,
          totalTime: (performance.now() - startTime) / 1000,
        })
        sessionManager.updateMessageStats(sessionId, result.messageId, stats)
        onMessage(createChatDoneMessage(result.messageId, 'stopped', stats))
        throw new Error('Aborted')
      }
      
      onMessage(createChatToolCallMessage(result.messageId, toolCall.id, toolCall.name, toolCall.arguments))
      
      // Create progress handler for streaming output (run_command only)
      const onProgress = createToolProgressHandler(result.messageId, toolCall.id, onMessage)
      
      const toolResult = await toolRegistry.execute(
        toolCall.name,
        toolCall.arguments,
        { sessionManager, workdir: session.workdir, sessionId, signal, lspManager: sessionManager.getLspManager(sessionId), onEvent: onMessage, onProgress, toolCallId: toolCall.id }
      )
      
      iterationToolTime += toolResult.durationMs
      totalToolTime += toolResult.durationMs
      
      onMessage(createChatToolResultMessage(result.messageId, toolCall.id, toolCall.name, toolResult))
      
      // Save tool result as separate message for LLM context
      // If the tool result contains image metadata, attach it so the LLM can see the image
      const imageMeta = toolResult.metadata as { mimeType?: string; dataUrl?: string; path?: string; size?: number } | undefined
      const toolMsgData: Parameters<typeof sessionManager.addMessage>[1] = {
        role: 'tool',
        content: toolResult.success
          ? (toolResult.output ?? 'Success')
          : toolResult.output
            ? `${toolResult.output}\n\nError: ${toolResult.error}`
            : `Error: ${toolResult.error}`,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        toolResult,
      }
      if (imageMeta?.dataUrl && imageMeta?.mimeType?.startsWith('image/')) {
        toolMsgData.attachments = [{
          id: crypto.randomUUID(),
          filename: imageMeta.path ?? 'image',
          mimeType: imageMeta.mimeType as Attachment['mimeType'],
          size: imageMeta.size ?? 0,
          data: imageMeta.dataUrl,
        }]
      }
      const toolMsg = sessionManager.addMessage(sessionId, toolMsgData)
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
    
    // Loop continues - model will see tool results and decide what to do next
    // (stats and chat.done handled by orchestrator at the end of entire run)
  }
  
  return {
    messageId: lastMessageId,
    hasToolCalls: madeAnyToolCalls,
    content: lastContent,
    timing: lastTiming!,
    usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
    toolTime: totalToolTime,
  }
}
