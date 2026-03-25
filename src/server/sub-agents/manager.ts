/**
 * Sub-Agent Manager
 *
 * Executes sub-agents with isolated context and restricted tool sets.
 * Uses EventStore-based streaming (streamLLMPure + consumeStreamGenerator).
 */

import type { Criterion, InjectedFile, StatsIdentity, ToolResult } from '../../shared/types.js'
import type { SessionManager } from '../session/index.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ToolRegistry } from '../tools/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { SubAgentType } from './types.js'
import { createSubAgentRegistry } from './registry.js'
import { streamLLMPure, consumeStreamGenerator, TurnMetrics, createMessageStartEvent, createMessageDoneEvent, createToolCallEvent, createToolResultEvent, createChatDoneEvent } from '../chat/stream-pure.js'
import { assembleVerifierRequest, type RequestContextMessage } from '../chat/request-context.js'
import { createToolProgressHandler } from '../chat/tool-streaming.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEventStore, getCurrentContextWindowId } from '../events/index.js'
import { PathAccessDeniedError } from '../tools/path-security.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Constants
// ============================================================================

const RETURN_VALUE_INSTRUCTION = `

## RETURN VALUE
As the very last thing you do, call \`return_value\` with a structured summary of your work. This is how your findings get passed back to the calling agent. Do not finish without calling return_value.`

const RETURN_VALUE_NUDGE = 'You must call return_value with a summary of your findings before finishing. Call return_value now.'

// ============================================================================
// Types
// ============================================================================

export interface NudgeConfig {
  maxConsecutiveNudges: number
  getCriteriaAwaiting: (criteria: Criterion[]) => Criterion[]
  buildNudgeContent: (criteria: Criterion[]) => string
  buildRestartContent: (criteria: Criterion[]) => string
}

export interface SubAgentExecutionOptions {
  subAgentType: SubAgentType
  prompt: string
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  toolRegistry: ToolRegistry
  turnMetrics: TurnMetrics
  statsIdentity: StatsIdentity
  signal?: AbortSignal | undefined
  onMessage?: ((msg: ServerMessage) => void) | undefined
  nudgeConfig?: NudgeConfig | undefined
}

export interface SubAgentResult {
  content: string
  allPassed?: boolean
  failed?: Array<{ id: string; reason: string }>
}

// ============================================================================
// Manager
// ============================================================================

function getCurrentWindowMessageOptions(sessionId: string): { contextWindowId: string } | undefined {
  const contextWindowId = getCurrentContextWindowId(sessionId)
  return contextWindowId ? { contextWindowId } : undefined
}

export async function executeSubAgent(options: SubAgentExecutionOptions): Promise<SubAgentResult> {
  const {
    subAgentType,
    prompt,
    sessionManager,
    sessionId,
    llmClient,
    toolRegistry,
    turnMetrics,
    statsIdentity,
    signal,
    onMessage,
    nudgeConfig,
  } = options

  const registry = createSubAgentRegistry()
  const definition = registry.getSubAgent(subAgentType)
  if (!definition) {
    throw new Error(`Unknown sub-agent type: ${subAgentType}`)
  }

  const eventStore = getEventStore()
  const subAgentId = crypto.randomUUID()
  let session = sessionManager.requireSession(sessionId)
  const currentWindowMessageOptions = getCurrentWindowMessageOptions(sessionId)

  // Build initial context
  const initialContext = definition.createContext(session, { prompt })

  logger.debug('Sub-agent starting', { subAgentType, subAgentId, sessionId })

  // Emit context reset marker
  const resetMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(resetMsgId, 'user', `Fresh Context - ${definition.name} Sub-Agent`, {
    ...(currentWindowMessageOptions ?? {}),
    isSystemGenerated: true,
    messageKind: 'context-reset',
    subAgentId,
    subAgentType,
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: resetMsgId } })

  // Emit context content (first message from createContext)
  if (initialContext.messages.length > 0) {
    const contextMsgId = crypto.randomUUID()
    eventStore.append(sessionId, createMessageStartEvent(contextMsgId, 'user', initialContext.messages[0]!.content, {
      ...(currentWindowMessageOptions ?? {}),
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      subAgentId,
      subAgentType,
    }))
    eventStore.append(sessionId, { type: 'message.done', data: { messageId: contextMsgId } })
  }

  // Emit kickoff prompt (last message from createContext, or the prompt itself)
  const kickoffContent = initialContext.messages.length > 1
    ? initialContext.messages[initialContext.messages.length - 1]!.content
    : prompt
  const kickoffMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(kickoffMsgId, 'user', kickoffContent, {
    ...(currentWindowMessageOptions ?? {}),
    isSystemGenerated: true,
    messageKind: 'auto-prompt',
    subAgentId,
    subAgentType,
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: kickoffMsgId } })

  // Load instructions for verifier (other types use simpler prompts)
  let instructionContent: string | undefined
  let injectedFiles: InjectedFile[] = []
  if (subAgentType === 'verifier') {
    const instructions = await getAllInstructions(session.workdir, session.projectId)
    instructionContent = instructions.content
    injectedFiles = instructions.files.map(file => ({
      path: file.path,
      content: file.content ?? '',
      source: file.source,
    }))
  }

  // Build custom messages for isolated context
  let customMessages: RequestContextMessage[] = initialContext.messages.map(m => ({
    role: m.role as 'user' | 'assistant' | 'tool',
    content: m.content,
    source: m.source as 'runtime' | 'history',
  }))

  let consecutiveEmptyStops = 0
  let finalContent = ''
  let returnValueContent: string | null = null
  let returnValueNudged = false

  for (;;) {
    if (signal?.aborted) {
      throw new Error('Aborted')
    }

    // Create assistant message
    const assistantMsgId = crypto.randomUUID()
    eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, {
      ...(currentWindowMessageOptions ?? {}),
      subAgentId,
      subAgentType,
    }))

    // Assemble request — verifier uses assembleVerifierRequest for injected files; others build directly
    const assembledRequest = subAgentType === 'verifier'
      ? assembleVerifierRequest({
          workdir: session.workdir,
          messages: customMessages,
          injectedFiles,
          promptTools: toolRegistry.definitions,
          toolChoice: 'auto',
          disableThinking: true,
          ...(instructionContent ? { customInstructions: instructionContent } : {}),
        })
      : {
          systemPrompt: definition.systemPrompt,
          messages: customMessages.map(m => ({
            role: m.role,
            content: m.content,
            ...(m.toolCalls ? { toolCalls: m.toolCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.arguments })) } : {}),
            ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
          })),
          promptContext: {
            systemPrompt: definition.systemPrompt,
            injectedFiles: [],
            userMessage: prompt,
            messages: customMessages.map(m => ({ role: m.role, content: m.content, source: m.source })),
            tools: toolRegistry.definitions.map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })),
            requestOptions: { toolChoice: 'auto' as const, disableThinking: initialContext.requestOptions.disableThinking },
          },
        }

    // Stream LLM response — append return_value instruction to all subagent prompts
    const streamGen = streamLLMPure({
      messageId: assistantMsgId,
      systemPrompt: assembledRequest.systemPrompt + RETURN_VALUE_INSTRUCTION,
      llmClient,
      messages: assembledRequest.messages,
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
      signal,
      disableThinking: initialContext.requestOptions.disableThinking,
    })

    const result = await consumeStreamGenerator(streamGen, event => {
      eventStore.append(sessionId, event)
    })

    if (result.aborted) {
      const stats = turnMetrics.buildStats(statsIdentity, subAgentType as 'verifier')
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        stats,
        partial: true,
        promptContext: assembledRequest.promptContext,
      }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
      throw new Error('Aborted')
    }

    // Track metrics
    turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)

    finalContent = result.content

    // Add assistant response to custom context
    customMessages.push({
      role: 'assistant',
      content: result.content,
      source: 'history',
      ...(result.toolCalls.length > 0 && { toolCalls: result.toolCalls }),
    })

    session = sessionManager.requireSession(sessionId)

    // If no tool calls, check nudge/stall logic (verifier) or finish
    if (result.toolCalls.length === 0) {
      if (nudgeConfig) {
        const criteriaAwaiting = nudgeConfig.getCriteriaAwaiting(session.criteria)
        if (criteriaAwaiting.length > 0) {
          if (consecutiveEmptyStops < nudgeConfig.maxConsecutiveNudges) {
            consecutiveEmptyStops += 1
            const nudgeContent = nudgeConfig.buildNudgeContent(criteriaAwaiting)
            const nudgeMsgId = crypto.randomUUID()

            eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
              segments: result.segments,
              promptContext: assembledRequest.promptContext,
            }))
            eventStore.append(sessionId, createMessageStartEvent(nudgeMsgId, 'user', nudgeContent, {
              ...(currentWindowMessageOptions ?? {}),
              isSystemGenerated: true,
              messageKind: 'correction',
              subAgentId,
              subAgentType,
            }))
            eventStore.append(sessionId, { type: 'message.done', data: { messageId: nudgeMsgId } })
            customMessages = [...customMessages, { role: 'user', content: nudgeContent, source: 'runtime' }]
            continue
          }

          // Stalled — emit restart message
          const stalledMsgId = crypto.randomUUID()
          eventStore.append(sessionId, createMessageStartEvent(stalledMsgId, 'user', nudgeConfig.buildRestartContent(criteriaAwaiting), {
            ...(currentWindowMessageOptions ?? {}),
            isSystemGenerated: true,
            messageKind: 'correction',
            subAgentId,
            subAgentType,
          }))
          eventStore.append(sessionId, { type: 'message.done', data: { messageId: stalledMsgId } })
        }
      }

      // Nudge once if return_value was never called
      if (!returnValueContent && !returnValueNudged) {
        returnValueNudged = true
        const nudgeMsgId = crypto.randomUUID()
        eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
          segments: result.segments,
          promptContext: assembledRequest.promptContext,
        }))
        eventStore.append(sessionId, createMessageStartEvent(nudgeMsgId, 'user', RETURN_VALUE_NUDGE, {
          ...(currentWindowMessageOptions ?? {}),
          isSystemGenerated: true,
          messageKind: 'correction',
          subAgentId,
          subAgentType,
        }))
        eventStore.append(sessionId, { type: 'message.done', data: { messageId: nudgeMsgId } })
        customMessages = [...customMessages, { role: 'user', content: RETURN_VALUE_NUDGE, source: 'runtime' }]
        continue
      }

      const stats = turnMetrics.buildStats(statsIdentity, subAgentType as 'verifier')
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        segments: result.segments,
        stats,
        promptContext: assembledRequest.promptContext,
      }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))
      break
    }

    // Emit message done (intermediate, no stats)
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
      segments: result.segments,
      promptContext: assembledRequest.promptContext,
    }))

    // Execute tool calls
    for (const toolCall of result.toolCalls) {
      if (signal?.aborted) {
        const stats = turnMetrics.buildStats(statsIdentity, subAgentType as 'verifier')
        eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
          stats,
          partial: true,
          promptContext: assembledRequest.promptContext,
        }))
        eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
        throw new Error('Aborted')
      }

      eventStore.append(sessionId, createToolCallEvent(assistantMsgId, toolCall))

      // Check for parse error
      if (toolCall.parseError) {
        const toolResult: ToolResult = {
          success: false,
          error: `Failed to parse tool call arguments: ${toolCall.parseError}. Please ensure your JSON function call arguments are valid.`,
          durationMs: 0,
          truncated: false,
        }
        turnMetrics.addToolTime(toolResult.durationMs)
        eventStore.append(sessionId, createToolResultEvent(assistantMsgId, toolCall.id, toolResult))
        customMessages.push({
          role: 'tool',
          content: `Error: ${toolResult.error}`,
          source: 'history',
          toolCallId: toolCall.id,
        })
        continue
      }

      // Create progress handler for streaming output (run_command only)
      const onProgress = onMessage ? createToolProgressHandler(assistantMsgId, toolCall.id, onMessage) : undefined

      let toolResult: ToolResult
      try {
        toolResult = await toolRegistry.execute(
          toolCall.name,
          toolCall.arguments,
          {
            sessionManager,
            workdir: session.workdir,
            sessionId,
            signal,
            lspManager: sessionManager.getLspManager(sessionId),
            onEvent: onMessage,
            onProgress,
          }
        )
      } catch (error) {
        if (error instanceof PathAccessDeniedError) {
          toolResult = {
            success: false,
            error: `User denied access to ${error.paths.join(', ')}. If you need this file, explain why and ask for permission.`,
            durationMs: 0,
            truncated: false,
          }
        } else {
          throw error
        }
      }

      turnMetrics.addToolTime(toolResult.durationMs)
      eventStore.append(sessionId, createToolResultEvent(assistantMsgId, toolCall.id, toolResult))

      // Capture return_value tool content
      if (toolCall.name === 'return_value' && !toolCall.parseError) {
        returnValueContent = (toolCall.arguments as Record<string, unknown>)['content'] as string
      }

      // Add tool result to custom context
      customMessages.push({
        role: 'tool',
        content: toolResult.success ? (toolResult.output ?? 'Success') : `Error: ${toolResult.error}`,
        source: 'history',
        toolCallId: toolCall.id,
      })

      // Check criteria changes
      const updatedSession = sessionManager.requireSession(sessionId)
      if (JSON.stringify(updatedSession.criteria) !== JSON.stringify(session.criteria)) {
        eventStore.append(sessionId, { type: 'criteria.set', data: { criteria: updatedSession.criteria } })
        session = updatedSession
      }
    }

    // Reset nudge counter when tools were called
    if (nudgeConfig) {
      session = sessionManager.requireSession(sessionId)
      const remaining = nudgeConfig.getCriteriaAwaiting(session.criteria)
      if (remaining.length === 0) {
        consecutiveEmptyStops = 0
      } else {
        // Tool calls made but criteria didn't change — still not an empty stop
        consecutiveEmptyStops = 0
      }
    }
  }

  logger.debug('Sub-agent execution complete', {
    subAgentType,
    subAgentId,
    resultLength: finalContent.length,
  })

  // Build result — for verifier, include pass/fail info
  if (subAgentType === 'verifier') {
    session = sessionManager.requireSession(sessionId)
    const remaining = nudgeConfig?.getCriteriaAwaiting(session.criteria) ?? []
    const failed = session.criteria
      .filter(c => c.status.type === 'failed')
      .map(c => ({
        id: c.id,
        reason: c.status.type === 'failed' ? c.status.reason : 'unknown',
      }))
    return {
      content: returnValueContent ?? finalContent,
      allPassed: failed.length === 0 && remaining.length === 0,
      failed,
    }
  }

  return { content: returnValueContent ?? finalContent }
}

// Backward-compatible factory (used by sub-agent.ts)
export function createSubAgentManager() {
  return { executeSubAgent }
}
