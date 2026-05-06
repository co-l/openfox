/**
 * Sub-Agent Manager
 *
 * Executes sub-agents with isolated context and restricted tool sets.
 * Uses the event store as the single source of truth for conversation history.
 * All messages are written to and read from the event store via getConversationMessages.
 */

import type { Criterion, InjectedFile, StatsIdentity } from '../../shared/types.js'
import type { SessionManager } from '../session/index.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ToolRegistry } from '../tools/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { AgentDefinition } from '../agents/types.js'
import { loadAllAgentsDefault, findAgentById } from '../agents/registry.js'
import { buildSubAgentSystemPrompt } from '../chat/prompts.js'
import {
  streamLLMPure,
  consumeStreamGenerator,
  TurnMetrics,
  createMessageStartEvent,
  createMessageDoneEvent,
  createChatDoneEvent,
} from '../chat/stream-pure.js'
import { executeToolBatch } from '../chat/agent-loop.js'
import { assembleAgentRequest } from '../chat/request-context.js'
import { getAllInstructions, toInjectedFiles } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { getEventStore, getCurrentContextWindowId } from '../events/index.js'
import { createChatMessageMessage, createChatMessageUpdatedMessage, createChatDoneMessage } from '../ws/protocol.js'
import { logger } from '../utils/logger.js'
import { getConversationMessages } from '../chat/conversation-history.js'
import { appendNudgeMessage, buildPromptContextForNudge } from '../context/nudge-helpers.js'

// ============================================================================
// Constants
// ============================================================================

const RETURN_VALUE_INSTRUCTION = `

## RETURN VALUE
As the very last thing you do, call \`return_value\` ONCE with a structured summary of your work. This is how your findings get passed back to the calling agent. Do not finish without calling return_value.`

const RETURN_VALUE_NUDGE =
  'You must call return_value with a summary of your findings before finishing. Call return_value now.'

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
  remaining: Criterion[],
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

  logger.debug('Sub-agent starting', { subAgentType, subAgentId, sessionId })

  // Emit context reset marker
  const resetMsgId = crypto.randomUUID()
  eventStore.append(
    sessionId,
    createMessageStartEvent(resetMsgId, 'user', `Fresh Context - ${agentDef.metadata.name} Sub-Agent`, {
      ...(currentWindowMessageOptions ?? {}),
      isSystemGenerated: true,
      messageKind: 'context-reset',
      subAgentId,
      subAgentType,
    }),
  )
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: resetMsgId } })

  // Emit the prompt as a user message in the event store
  const promptMsgId = crypto.randomUUID()
  eventStore.append(
    sessionId,
    createMessageStartEvent(promptMsgId, 'user', prompt, {
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
    }),
  )
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: promptMsgId } })
  if (onMessage) {
    onMessage(
      createChatMessageMessage({
        id: promptMsgId,
        role: 'user',
        content: prompt,
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
      }),
    )
  }

  // Load instructions and skills for the sub-agent system prompt
  const { content: instructionContent, files } = await getAllInstructions(session.workdir, session.projectId)
  const injectedFiles: InjectedFile[] = toInjectedFiles(files)

  const configDir = getGlobalConfigDir(getRuntimeConfig().mode ?? 'production')
  const skills = await getEnabledSkillMetadata(configDir)

  // Build system prompt from the agent definition
  const systemPrompt = buildSubAgentSystemPrompt(
    session.workdir,
    agentDef,
    skills.length > 0 ? skills : undefined,
    llmClient.getModel(),
  )

  const subAgentScope = { type: 'subagent' as const, sessionId, subAgentId, subAgentType }

  let consecutiveEmptyStops = 0
  let finalContent: string
  let returnValueContent: string | null = null
  let returnValueResult: string | undefined = undefined
  let returnValueNudged = false

  for (;;) {
    if (signal?.aborted) {
      throw new Error('Aborted')
    }

    // Read conversation history from the event store — single source of truth
    const requestMessages = getConversationMessages(subAgentScope)

    // Create assistant message
    const assistantMsgId = crypto.randomUUID()
    eventStore.append(
      sessionId,
      createMessageStartEvent(assistantMsgId, 'assistant', undefined, {
        ...(currentWindowMessageOptions ?? {}),
        subAgentId,
        subAgentType,
      }),
    )

    // Build prompt context for diagnostics
    const promptContext = buildPromptContextForNudge(
      systemPrompt,
      injectedFiles,
      prompt,
      requestMessages,
      toolRegistry.definitions,
    )

    // Assemble the request through the same pipeline as top-level agents
    const assembledRequest = assembleAgentRequest({
      agentDef,
      subAgentDefs: [],
      workdir: session.workdir,
      messages: requestMessages,
      injectedFiles,
      promptTools: toolRegistry.definitions,
      requestTools: toolRegistry.definitions,
      toolChoice: 'auto',
      disableThinking: true,
      ...(instructionContent ? { customInstructions: instructionContent } : {}),
      ...(skills.length > 0 ? { skills } : {}),
      modelName: llmClient.getModel(),
    })

    // Append return_value instruction to system prompt (sub-agent specific)
    const effectiveSystemPrompt = assembledRequest.systemPrompt + RETURN_VALUE_INSTRUCTION

    // Stream LLM response
    const streamGen = streamLLMPure({
      messageId: assistantMsgId,
      systemPrompt: effectiveSystemPrompt,
      llmClient,
      messages: assembledRequest.messages,
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
      signal,
      disableThinking: true,
    })

    const result = await consumeStreamGenerator(streamGen, (event) => {
      eventStore.append(sessionId, event)
    })

    if (result.aborted) {
      const stats = turnMetrics.buildStats(statsIdentity, 'verifier')
      eventStore.append(
        sessionId,
        createMessageDoneEvent(assistantMsgId, {
          stats,
          partial: true,
          promptContext,
        }),
      )
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
      throw new Error('Aborted')
    }

    // Track metrics
    turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens, result.modelParams)

    finalContent = result.content

    session = sessionManager.requireSession(sessionId)

    // If no tool calls, check nudge/stall logic or finish
    if (result.toolCalls.length === 0) {
      if (nudgeConfig) {
        const criteriaAwaiting = nudgeConfig.getCriteriaAwaiting(session.criteria)
        if (criteriaAwaiting.length > 0) {
          if (consecutiveEmptyStops < nudgeConfig.maxConsecutiveNudges) {
            consecutiveEmptyStops += 1
            const nudgeContent = nudgeConfig.buildNudgeContent(criteriaAwaiting)

            eventStore.append(
              sessionId,
              createMessageDoneEvent(assistantMsgId, {
                segments: result.segments,
                promptContext,
              }),
            )
            appendNudgeMessage(eventStore, sessionId, nudgeContent, currentWindowMessageOptions, {
              subAgentId,
              subAgentType,
            })
            // Nudge is in the event store; next iteration reads it from there
            continue
          }

          // Stalled — emit restart message
          const stalledMsgId = crypto.randomUUID()
          eventStore.append(
            sessionId,
            createMessageStartEvent(stalledMsgId, 'user', nudgeConfig.buildRestartContent(criteriaAwaiting), {
              ...(currentWindowMessageOptions ?? {}),
              isSystemGenerated: true,
              messageKind: 'correction',
              subAgentId,
              subAgentType,
            }),
          )
          eventStore.append(sessionId, { type: 'message.done', data: { messageId: stalledMsgId } })
        }
      }

      // Nudge once if return_value was never called
      if (!returnValueContent && !returnValueNudged) {
        returnValueNudged = true
        eventStore.append(
          sessionId,
          createMessageDoneEvent(assistantMsgId, {
            segments: result.segments,
            promptContext,
          }),
        )
        appendNudgeMessage(eventStore, sessionId, RETURN_VALUE_NUDGE, currentWindowMessageOptions, {
          subAgentId,
          subAgentType,
        })
        // Nudge is in the event store; next iteration reads it from there
        continue
      }

      const stats = turnMetrics.buildStats(statsIdentity, 'verifier')
      eventStore.append(
        sessionId,
        createMessageDoneEvent(assistantMsgId, {
          segments: result.segments,
          stats,
          promptContext,
        }),
      )
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))
      break
    }

    // Emit message done (intermediate, no stats)
    eventStore.append(
      sessionId,
      createMessageDoneEvent(assistantMsgId, {
        segments: result.segments,
        promptContext,
      }),
    )

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

      const stats = turnMetrics.buildStats(statsIdentity, subAgentType)
      eventStore.append(
        sessionId,
        createMessageDoneEvent(assistantMsgId, {
          segments: result.segments,
          stats,
          promptContext,
        }),
      )
      if (onMessage) {
        onMessage(createChatMessageUpdatedMessage(assistantMsgId, { isStreaming: false, stats, promptContext }))
      }
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))
      if (onMessage) {
        onMessage(createChatDoneMessage(assistantMsgId, 'complete', stats, 'sub-agent'))
      }
      break
    }

    // Tool results are in the event store (written by executeToolBatch);
    // next iteration reads them from there via getConversationMessages

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
    .filter((c) => c.status.type === 'failed')
    .map((c) => ({ id: c.id, reason: (c.status as { reason?: string | null }).reason ?? 'unknown' }))
  const remaining = nudgeConfig?.getCriteriaAwaiting(session.criteria) ?? []

  return buildSubAgentResult(
    returnValueContent ?? undefined,
    returnValueResult ?? (subAgentType !== 'verifier' ? 'success' : undefined),
    subAgentType,
    failed,
    remaining,
  )
}

// Backward-compatible factory (used by sub-agent.ts)
export function createSubAgentManager() {
  return { executeSubAgent }
}
