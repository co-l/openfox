/**
 * Sub-Agent Manager
 *
 * Executes sub-agents with isolated context and restricted tool sets.
 * Uses the agent registry (.agent.md files) for agent definitions and
 * standalone context builders for fresh context assembly.
 */

import type { Criterion, InjectedFile, StatsIdentity, ToolResult } from '../../shared/types.js'
import type { SessionManager } from '../session/index.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ToolRegistry } from '../tools/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { AgentDefinition } from '../agents/types.js'
import { loadAllAgentsDefault, findAgentById } from '../agents/registry.js'
import { buildSubAgentSystemPrompt } from '../chat/prompts.js'
import { streamLLMPure, consumeStreamGenerator, TurnMetrics, createMessageStartEvent, createMessageDoneEvent, createChatDoneEvent } from '../chat/stream-pure.js'
import { executeToolBatch } from '../chat/agent-loop.js'
import { assembleAgentRequest, type RequestContextMessage } from '../chat/request-context.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { getEventStore, getCurrentContextWindowId } from '../events/index.js'
import { createChatMessageMessage, createChatMessageUpdatedMessage, createChatDoneMessage } from '../ws/protocol.js'
import { logger } from '../utils/logger.js'
import { resolveCompactionStatsIdentity, maybeAutoCompactContext } from '../context/auto-compaction.js'
import { appendNudgeMessage } from '../context/nudge-helpers.js'

// ============================================================================
// Constants
// ============================================================================

const RETURN_VALUE_INSTRUCTION = `

## RETURN VALUE
As the very last thing you do, call \`return_value\` ONCE with a structured summary of your work. This is how your findings get passed back to the calling agent. Do not finish without calling return_value.`

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
  subAgentType: string
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
  result?: string
  allPassed?: boolean
  failed?: Array<{ id: string; reason: string }>
}

export function buildSubAgentResult(
  returnValueContent: string | undefined | null,
  returnValueResult: string | undefined | null,
  subAgentType: string,
  failed: Array<{ id: string; reason: string }>,
  remaining: Criterion[]
): SubAgentResult {
  return {
    content: returnValueContent ?? '',
    ...(returnValueResult !== null && returnValueResult !== undefined ? { result: returnValueResult } : {}),
    ...(subAgentType === 'verifier' ? { allPassed: failed.length === 0 && remaining.length === 0, failed } : {}),
  }
}

// ============================================================================
// Agent Definition Resolution
// ============================================================================

async function resolveAgentDef(agentId: string): Promise<AgentDefinition> {
  const allAgents = await loadAllAgentsDefault()
  const def = findAgentById(agentId, allAgents)
  if (!def) {
    throw new Error(`Unknown sub-agent type: ${agentId}`)
  }
  if (!def.metadata.subagent) {
    throw new Error(`Agent '${agentId}' is not a sub-agent`)
  }
  return def
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

  const agentDef = await resolveAgentDef(subAgentType)

  const eventStore = getEventStore()
  const subAgentId = crypto.randomUUID()
  let session = sessionManager.requireSession(sessionId)
  const currentWindowMessageOptions = getCurrentWindowMessageOptions(sessionId)

  // Build initial context messages — prompt arrives pre-resolved with template variables
  const contextMessages: RequestContextMessage[] = [
    { role: 'user', content: prompt, source: 'runtime' },
  ]

  logger.debug('Sub-agent starting', { subAgentType, subAgentId, sessionId })

  // Emit context reset marker
  const resetMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(resetMsgId, 'user', `Fresh Context - ${agentDef.metadata.name} Sub-Agent`, {
    ...(currentWindowMessageOptions ?? {}),
    isSystemGenerated: true,
    messageKind: 'context-reset',
    subAgentId,
    subAgentType,
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: resetMsgId } })

  // Emit context messages as events for the UI feed
  for (const msg of contextMessages) {
    const msgId = crypto.randomUUID()
    eventStore.append(sessionId, createMessageStartEvent(msgId, 'user', msg.content, {
      ...(currentWindowMessageOptions ?? {}),
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      subAgentId,
      subAgentType,
      metadata: {
        type: 'subagent',
        name: agentDef.metadata.name,
        color: agentDef.metadata.color ?? '#6b7280',
      },
    }))
    eventStore.append(sessionId, { type: 'message.done', data: { messageId: msgId } })
    if (onMessage) {
      onMessage(createChatMessageMessage({
        id: msgId,
        role: 'user',
        content: msg.content,
        timestamp: new Date().toISOString(),
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
        subAgentId,
        subAgentType,
        metadata: {
          type: 'subagent',
          name: agentDef.metadata.name,
          color: agentDef.metadata.color ?? '#6b7280',
        },
      }))
    }
  }

  // Load instructions and skills for the sub-agent system prompt
  const { content: instructionContent, files } = await getAllInstructions(session.workdir, session.projectId)
  const injectedFiles: InjectedFile[] = files.map(file => ({
    path: file.path,
    content: file.content ?? '',
    source: file.source,
  }))

  const configDir = getGlobalConfigDir(getRuntimeConfig().mode ?? 'production')
  const skills = await getEnabledSkillMetadata(configDir)

  // Build system prompt from the agent definition
  const systemPrompt = buildSubAgentSystemPrompt(
    session.workdir,
    agentDef,
    skills.length > 0 ? skills : undefined,
  )

  // Build custom messages for isolated context
  let customMessages: RequestContextMessage[] = [...contextMessages]

  let consecutiveEmptyStops = 0
  let finalContent = ''
  let returnValueContent: string | null = null
  let returnValueResult: string | undefined = undefined
  let returnValueNudged = false

  for (;;) {
    if (signal?.aborted) {
      throw new Error('Aborted')
    }

    // Check if auto-compaction is needed for this subagent's context
    await maybeAutoCompactContext({
      sessionManager,
      sessionId,
      llmClient,
      statsIdentity: resolveCompactionStatsIdentity(llmClient),
      ...(signal ? { signal } : {}),
    })

    // Create assistant message
    const assistantMsgId = crypto.randomUUID()
    eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, {
      ...(currentWindowMessageOptions ?? {}),
      subAgentId,
      subAgentType,
    }))

    // Build prompt context for diagnostics
    const promptContext = {
      systemPrompt,
      injectedFiles,
      userMessage: prompt,
      messages: customMessages.map(m => ({ role: m.role, content: m.content, source: m.source })),
      tools: toolRegistry.definitions.map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })),
      requestOptions: { toolChoice: 'auto' as const, disableThinking: true },
    }

    // Stream LLM response — append return_value instruction to all subagent prompts
    const streamGen = streamLLMPure({
      messageId: assistantMsgId,
      systemPrompt: systemPrompt + RETURN_VALUE_INSTRUCTION,
      llmClient,
      messages: customMessages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls ? { toolCalls: m.toolCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.arguments })) } : {}),
        ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      })),
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
      signal,
      disableThinking: true,
    })

    const result = await consumeStreamGenerator(streamGen, event => {
      eventStore.append(sessionId, event)
    })

    if (result.aborted) {
      const stats = turnMetrics.buildStats(statsIdentity, 'verifier')
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        stats,
        partial: true,
        promptContext,
      }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
      throw new Error('Aborted')
    }

    // Track metrics
    turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
    sessionManager.setCurrentContextSize(sessionId, result.usage.promptTokens, subAgentId)

    finalContent = result.content

    // Add assistant response to custom context
    customMessages.push({
      role: 'assistant',
      content: result.content,
      source: 'history',
      ...(result.toolCalls.length > 0 && { toolCalls: result.toolCalls }),
    })

    session = sessionManager.requireSession(sessionId)

    // If no tool calls, check nudge/stall logic or finish
    if (result.toolCalls.length === 0) {
      if (nudgeConfig) {
        const criteriaAwaiting = nudgeConfig.getCriteriaAwaiting(session.criteria)
        if (criteriaAwaiting.length > 0) {
          if (consecutiveEmptyStops < nudgeConfig.maxConsecutiveNudges) {
            consecutiveEmptyStops += 1
            const nudgeContent = nudgeConfig.buildNudgeContent(criteriaAwaiting)

            eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
              segments: result.segments,
              promptContext,
            }))
            appendNudgeMessage(eventStore, sessionId, nudgeContent, currentWindowMessageOptions, { subAgentId, subAgentType })
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
        eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
          segments: result.segments,
          promptContext,
        }))
        appendNudgeMessage(eventStore, sessionId, RETURN_VALUE_NUDGE, currentWindowMessageOptions, { subAgentId, subAgentType })
        customMessages = [...customMessages, { role: 'user', content: RETURN_VALUE_NUDGE, source: 'runtime' }]
        continue
      }

      const stats = turnMetrics.buildStats(statsIdentity, 'verifier')
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        segments: result.segments,
        stats,
        promptContext,
      }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))
      break
    }

    // Emit message done (intermediate, no stats)
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
      segments: result.segments,
      promptContext,
    }))

    // Execute tool calls using shared helper
    const batchResult = await executeToolBatch(assistantMsgId, result.toolCalls, {
      toolRegistry,
      sessionManager,
      sessionId,
      workdir: session.workdir,
      turnMetrics,
      signal,
      onMessage,
    })

    // Capture return_value content and result
    if (batchResult.returnValueContent) {
      returnValueContent = batchResult.returnValueContent
      returnValueResult = batchResult.returnValueResult
      customMessages = [...customMessages, ...batchResult.toolMessages]
      
      const stats = turnMetrics.buildStats(statsIdentity, subAgentType)
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        segments: result.segments,
        stats,
        promptContext,
      }))
      if (onMessage) {
        onMessage(createChatMessageUpdatedMessage(assistantMsgId, { isStreaming: false, stats, promptContext }))
      }
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))
      if (onMessage) {
        onMessage(createChatDoneMessage(assistantMsgId, 'complete', stats, 'sub-agent'))
      }
      break
    }

    // Add tool results to custom context
    customMessages = [...customMessages, ...batchResult.toolMessages]

    // Check criteria changes
    session = sessionManager.requireSession(sessionId)

    // Reset nudge counter when tools were called
    if (nudgeConfig) {
      consecutiveEmptyStops = 0
    }
  }

  logger.debug('Sub-agent execution complete', {
    subAgentType,
    subAgentId,
    resultLength: finalContent.length,
  })

  const failed = session.criteria
    .filter(c => c.status.type === 'failed')
    .map(c => ({ id: c.id, reason: (c.status as { reason?: string | null }).reason ?? 'unknown' }))
  const remaining = nudgeConfig?.getCriteriaAwaiting(session.criteria) ?? []

  return buildSubAgentResult(returnValueContent ?? undefined, returnValueResult ?? (subAgentType !== 'verifier' ? 'success' : undefined), subAgentType, failed, remaining)
}

// Backward-compatible factory (used by sub-agent.ts)
export function createSubAgentManager() {
  return { executeSubAgent }
}
