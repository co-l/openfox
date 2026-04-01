/**
 * Chat Orchestrator
 *
 * Orchestrates chat turns by:
 * 1. Consuming pure generators that yield TurnEvents
 * 2. Appending events to EventStore
 * 3. Executing tools and yielding tool events
 * 4. Creating snapshots at end of turn
 *
 * This is the ONE place where events get appended to the store.
 */

import type { MessageStats, StatsIdentity, ToolCall, ToolResult } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { SessionSnapshot } from '../events/types.js'
import type { AgentDefinition } from '../agents/types.js'
import { getEventStore, getCurrentContextWindowId } from '../events/index.js'
import { buildSnapshotFromSessionState } from '../events/folding.js'
import type { SessionManager } from '../session/index.js'
import { getToolRegistryForAgent, PathAccessDeniedError } from '../tools/index.js'
import { BUILDER_KICKOFF_PROMPT, VERIFIER_KICKOFF_PROMPT, buildAgentReminder } from './prompts.js'
import { TurnMetrics, createMessageStartEvent, createMessageDoneEvent, createToolCallEvent, createToolResultEvent, createChatDoneEvent } from './stream-pure.js'
import { assembleAgentRequest } from './request-context.js'
import { runTopLevelAgentLoop } from './agent-loop.js'
import { executeSubAgent } from '../sub-agents/manager.js'
import { createVerifierNudgeConfig } from '../sub-agents/verifier-helpers.js'
import { loadAllAgentsDefault, findAgentById, getSubAgents } from '../agents/registry.js'
import { logger } from '../utils/logger.js'

// Re-export for runner orchestrator
export { TurnMetrics, createMessageStartEvent, createMessageDoneEvent, createToolCallEvent, createToolResultEvent, createChatDoneEvent }

function getCurrentWindowMessageOptions(sessionId: string): { contextWindowId: string } | undefined {
  const contextWindowId = getCurrentContextWindowId(sessionId)
  return contextWindowId ? { contextWindowId } : undefined
}

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorOptions {
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  statsIdentity?: StatsIdentity
  signal?: AbortSignal
  injectBuilderKickoff?: boolean
  /** Optional callback for WebSocket forwarding (temporary, until WS layer is refactored) */
  onMessage?: (msg: ServerMessage) => void
}

function resolveStatsIdentity(options: OrchestratorOptions): StatsIdentity {
  const model = options.llmClient.getModel()

  if (options.statsIdentity) {
    return {
      ...options.statsIdentity,
      model,
    }
  }

  return {
    providerId: `provider:${model}`,
    providerName: 'Unknown Provider',
    backend: 'unknown',
    model,
  }
}

// ============================================================================
// Core Orchestrator
// ============================================================================

/**
 * Run a chat turn in the current mode.
 * Appends all events to EventStore and creates a snapshot at end of turn.
 */
export async function runChatTurn(options: OrchestratorOptions): Promise<void> {
  const { sessionManager, sessionId } = options
  const eventStore = getEventStore()
  const statsIdentity = resolveStatsIdentity(options)

  const session = sessionManager.requireSession(sessionId)
  const mode = session.mode

  logger.debug('Starting chat turn', { sessionId, mode })

  // Track metrics across the turn
  const turnMetrics = new TurnMetrics()

  try {
    // Run the appropriate handler based on mode (agent ID)
    if (mode === 'builder') {
      await runBuilderTurn(options, turnMetrics)
    } else {
      await runGenericAgentTurn(options, turnMetrics, mode)
    }

    // Create end-of-turn snapshot
    const snapshot = buildSnapshot(sessionManager, sessionId, turnMetrics.buildStats(statsIdentity, mode))
    const snapshotEvent = eventStore.append(sessionId, { type: 'turn.snapshot', data: snapshot })

    const deletedCount = eventStore.cleanupOldEvents(sessionId)
    if (deletedCount > 0) {
      logger.debug('Cleaned up old events after snapshot', { sessionId, deletedCount, snapshotSeq: snapshotEvent.seq })
    }

  } catch (error) {
    if (error instanceof PathAccessDeniedError) {
      const errorMsgId = crypto.randomUUID()
      const reasonText = error.reason === 'sensitive_file'
        ? 'sensitive files that may contain secrets'
        : error.reason === 'both'
        ? 'files outside the project and sensitive files'
        : 'files outside the project directory'
      eventStore.append(sessionId, {
        type: 'chat.error',
        data: {
          error: `User denied access to ${reasonText}.`,
          recoverable: false,
        },
      })
      eventStore.append(sessionId, createMessageStartEvent(errorMsgId, 'user', `Access denied: ${error.paths.join(', ')}. If you need this file, explain why and ask the user for permission.`, {
        ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
        isSystemGenerated: true,
        messageKind: 'correction',
      }))
      eventStore.append(sessionId, createChatDoneEvent(errorMsgId, 'error'))
      return
    }

    if (error instanceof Error && error.message === 'Aborted') {
      return
    }

    logger.error('Chat turn error', { sessionId, mode, error })
    const errorMsgId = crypto.randomUUID()
    eventStore.append(sessionId, {
      type: 'chat.error',
      data: {
        error: error instanceof Error ? error.message : 'Unknown error',
        recoverable: false,
      },
    })
    eventStore.append(sessionId, createMessageStartEvent(errorMsgId, 'user', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
      ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
      isSystemGenerated: true,
      messageKind: 'correction',
    }))
    eventStore.append(sessionId, createChatDoneEvent(errorMsgId, 'error'))
  } finally {
    eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: false } })
  }
}

// ============================================================================
// Generic Agent Turn (works for planner, custom agents, etc.)
// ============================================================================

/**
 * Inject system reminder only on mode switch.
 * Tracks last mode in session state to avoid re-injecting on subsequent turns.
 * This ensures the reminder is preserved across context compaction and session reloads.
 */
function injectModeReminderIfNeeded(
  sessionManager: SessionManager,
  sessionId: string,
  agentId: string,
  allAgents: AgentDefinition[]
): void {
  const eventStore = getEventStore()
  const session = sessionManager.requireSession(sessionId)
  
  // Check if we already injected this mode's reminder
  const lastModeReminder = session.executionState?.lastModeWithReminder
  
  // Only inject if mode changed or this is the first time
  if (lastModeReminder === agentId) {
    return
  }
  
  // Inject reminder for new mode
  const agentDef = findAgentById(agentId, allAgents)
  if (!agentDef) return
  
  const reminderContent = buildAgentReminder(agentDef)
  const reminderMsgId = crypto.randomUUID()
  const currentWindowMessageOptions = getCurrentContextWindowId(sessionId)
    ? { contextWindowId: getCurrentContextWindowId(sessionId)! }
    : undefined
  
  eventStore.append(sessionId, {
    type: 'message.start',
    data: {
      messageId: reminderMsgId,
      role: 'user',
      content: reminderContent,
      ...(currentWindowMessageOptions ?? {}),
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
    },
  })
  eventStore.append(sessionId, {
    type: 'message.done',
    data: { messageId: reminderMsgId },
  })
  
  // Update execution state to track which mode we injected the reminder for
  sessionManager.updateExecutionState(sessionId, {
    lastModeWithReminder: agentId,
  })
}

async function runGenericAgentTurn(
  options: OrchestratorOptions,
  turnMetrics: TurnMetrics,
  agentId: string,
): Promise<void> {
  const statsIdentity = resolveStatsIdentity(options)
  const allAgents = await loadAllAgentsDefault()
  
  // Inject mode reminder only on mode switch
  injectModeReminderIfNeeded(options.sessionManager, options.sessionId, agentId, allAgents)
  
  const agentDef = findAgentById(agentId, allAgents) ?? findAgentById('planner', allAgents)!
  const subAgentDefs = getSubAgents(allAgents)

  await runTopLevelAgentLoop({
    mode: agentId,
    sessionManager: options.sessionManager,
    sessionId: options.sessionId,
    llmClient: options.llmClient,
    statsIdentity,
    signal: options.signal,
    onMessage: options.onMessage,
    assembleRequest: (input) => assembleAgentRequest({ ...input, agentDef, subAgentDefs }),
    getToolRegistry: () => getToolRegistryForAgent(agentDef),
  }, turnMetrics)
}

// ============================================================================
// Builder Turn
// ============================================================================

export interface BuilderTurnOptions extends OrchestratorOptions {
  injectBuilderKickoff?: boolean
  injectStepDone?: boolean
  stepDonePrompt?: string
}

export async function runBuilderTurn(
  options: BuilderTurnOptions,
  turnMetrics: TurnMetrics,
): Promise<{ returnValueContent?: string; returnValueResult?: string; stepDoneCalled?: boolean }> {
  const { sessionManager, sessionId } = options
  const statsIdentity = resolveStatsIdentity(options)
  const eventStore = getEventStore()
  const allAgents = await loadAllAgentsDefault()
  
  // Inject mode reminder only on mode switch
  injectModeReminderIfNeeded(options.sessionManager, options.sessionId, 'builder', allAgents)
  
  const builderDef = findAgentById('builder', allAgents)!
  const subAgentDefs = getSubAgents(allAgents)

  let stepDoneCalled = false

  return {
    ...(await runTopLevelAgentLoop({
      mode: 'builder',
      sessionManager,
      sessionId,
      llmClient: options.llmClient,
      statsIdentity,
      signal: options.signal,
      onMessage: options.onMessage,
      assembleRequest: (input) => assembleAgentRequest({ ...input, agentDef: builderDef, subAgentDefs }),
      getToolRegistry: () => {
        const baseRegistry = getToolRegistryForAgent(builderDef)
        if (options.injectStepDone === true) {
          return baseRegistry
        }
        // Filter out step_done tool for direct chat (non-workflow) turns
        return {
          tools: baseRegistry.tools.filter(t => t.name !== 'step_done'),
          definitions: baseRegistry.definitions.filter(d => d.type === 'function' && d.function.name !== 'step_done'),
          execute: baseRegistry.execute,
        }
      },
      onToolExecuted: (toolCall: ToolCall, toolResult: ToolResult) => {
        if (toolCall.name === 'step_done' && toolResult.success) {
          stepDoneCalled = true
        }
        if (toolResult.success && ['write_file', 'edit_file'].includes(toolCall.name)) {
          const path = toolCall.arguments['path'] as string
          sessionManager.addModifiedFile(sessionId, path)
        }
      },
      injectKickoff: () => {
        if (options.injectBuilderKickoff !== true) return
        const session = sessionManager.requireSession(sessionId)
        const events = eventStore.getEvents(sessionId)
        const hasBuilderKickoff = events.some(e => {
          if (e.type !== 'message.start') return false
          const data = e.data as { messageKind?: string; content?: string }
          return data.messageKind === 'auto-prompt' && data.content?.includes('fulfil the')
        })

        if (!hasBuilderKickoff) {
          const kickoffMsgId = crypto.randomUUID()
          const kickoffContent = BUILDER_KICKOFF_PROMPT(session.criteria.length)
          eventStore.append(sessionId, createMessageStartEvent(kickoffMsgId, 'user', kickoffContent, {
            ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
            isSystemGenerated: true,
            messageKind: 'auto-prompt',
          }))
          eventStore.append(sessionId, { type: 'message.done', data: { messageId: kickoffMsgId } })
        }
      },
    }, turnMetrics)),
    stepDoneCalled,
  }
}

// ============================================================================
// Verifier Turn (Fresh Context)
// ============================================================================

export interface VerifierResult {
  allPassed: boolean
  failed: Array<{ id: string; reason: string }>
  content?: string
}

/**
 * Run a verifier turn with fresh context.
 * Delegates to SubAgentManager for execution.
 */
export async function runVerifierTurn(
  options: OrchestratorOptions,
  turnMetrics: TurnMetrics
): Promise<VerifierResult> {
  const { sessionManager, sessionId, llmClient, signal, onMessage } = options
  const statsIdentity = resolveStatsIdentity(options)

  const session = sessionManager.requireSession(sessionId)
  const toVerify = session.criteria.filter(c => c.status.type === 'completed')
  if (toVerify.length === 0) {
    logger.debug('Nothing to verify', { sessionId })
    return { allPassed: true, failed: [] }
  }

  const allAgents = await loadAllAgentsDefault()
  const verifierDef = findAgentById('verifier', allAgents)!
  const toolRegistry = getToolRegistryForAgent(verifierDef)

  const result = await executeSubAgent({
    subAgentType: 'verifier',
    prompt: VERIFIER_KICKOFF_PROMPT,
    sessionManager,
    sessionId,
    llmClient,
    toolRegistry,
    turnMetrics,
    statsIdentity,
    signal,
    onMessage,
    nudgeConfig: createVerifierNudgeConfig(),
  })

  return {
    allPassed: result.allPassed ?? true,
    failed: result.failed ?? [],
    content: result.content,
  }
}

/**
 * Build a snapshot of current session state.
 */
function buildSnapshot(sessionManager: SessionManager, sessionId: string, lastStats?: MessageStats): SessionSnapshot {
  const eventStore = getEventStore()
  const session = sessionManager.requireSession(sessionId)
  const events = eventStore.getEvents(sessionId)
  const latestSeq = eventStore.getLatestSeq(sessionId) ?? 0

  return buildSnapshotFromSessionState({
    session,
    events,
    latestSeq,
  })
}
