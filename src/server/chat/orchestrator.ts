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
import { getEventStore, getCurrentContextWindowId, getCurrentWindowMessageOptions } from '../events/index.js'
import { buildSnapshotFromSessionState } from '../events/folding.js'
import type { SessionManager } from '../session/index.js'
import { getToolRegistryForAgent, PathAccessDeniedError } from '../tools/index.js'
import { buildAgentReminder, buildAgentSmallReminder } from './prompts.js'
import {
  TurnMetrics,
  createMessageStartEvent,
  createMessageDoneEvent,
  createToolCallEvent,
  createToolResultEvent,
  createChatDoneEvent,
} from './stream-pure.js'
import { createAssemblyResult } from './request-context.js'
import type { RequestContextMessage } from './request-context.js'
import { buildCachedPrompt, computeDynamicContextHash, getToolFingerprint } from './dynamic-context.js'
import { runTopLevelAgentLoop } from './agent-loop.js'
import { loadAllAgentsDefault, findAgentById } from '../agents/registry.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { logger } from '../utils/logger.js'
import type { RetryPatternConfig } from './auto-patterns.js'
import { getConversationMessages, processEventsForConversation } from './conversation-history.js'

// Re-export for runner orchestrator
export {
  TurnMetrics,
  createMessageStartEvent,
  createMessageDoneEvent,
  createToolCallEvent,
  createToolResultEvent,
  createChatDoneEvent,
}

async function buildRetryPatterns(): Promise<{ retryPatterns: RetryPatternConfig[]; maxRetriesPerTurn: number }> {
  const { getSetting, SETTINGS_KEYS } = await import('../db/settings.js')
  const raw = getSetting(SETTINGS_KEYS.RETRY_PATTERNS)
  if (!raw) {
    // Migration: check old llm.disableXmlProtection setting
    const oldXmlProtection = getSetting('llm.disableXmlProtection')
    if (oldXmlProtection !== null) {
      // User had the old setting — migrate to retry patterns
      const disabled = oldXmlProtection === 'true'
      return {
        retryPatterns: disabled
          ? []
          : [{ field: 'both', pattern: '<(tool_call|function=|/tool_call|parameter=)', action: 'retry', active: true }],
        maxRetriesPerTurn: 10,
      }
    }
    return { retryPatterns: [], maxRetriesPerTurn: 10 }
  }
  try {
    const parsed = JSON.parse(raw)
    return {
      retryPatterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
      maxRetriesPerTurn: typeof parsed.maxRetriesPerTurn === 'number' ? parsed.maxRetriesPerTurn : 10,
    }
  } catch {
    return { retryPatterns: [], maxRetriesPerTurn: 10 }
  }
}

function buildGetConversationMessages(
  sessionId: string,
  llmClient: LLMClientWithModel,
  append: (event: import('../events/types.js').TurnEvent) => void,
): () => Promise<RequestContextMessage[]> {
  return async () => {
    const processedEvents = await processEventsForConversation(sessionId, llmClient, (event) => append(event))
    return getConversationMessages({ type: 'toplevel', sessionId }, { events: processedEvents })
  }
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
  /** Optional callback for WebSocket forwarding (temporary, until WS layer is refactored) */
  onMessage?: (msg: ServerMessage) => void
  /** When true, the agent loop starts in compacting mode (manual compaction).
   *  After compaction completes, the loop breaks. */
  initialCompacting?: boolean
  /** When true, only warm up the LLM cache — no events, no messages, no tools. */
  warmup?: boolean
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

  // Mark session as running (cleared in finally)
  sessionManager.setRunning(sessionId, true)

  // Create append closure — the only write path to EventStore from the loop
  const append = (event: import('../events/types.js').TurnEvent) => {
    try {
      eventStore.append(sessionId, event)
    } catch {
      // Session may have been deleted (e.g. during abort) — skip
    }
  }

  // Track metrics across the turn
  const turnMetrics = new TurnMetrics()

  try {
    // Generic: use session mode as the agent ID. Workflow-specific callbacks
    // (kickoff injection, step_done tracking) are handled by the workflow executor
    // which calls runAgentTurn directly — not through runChatTurn.
    await runAgentTurn(options, turnMetrics, mode, append)

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
      const reasonText =
        error.reason === 'sensitive_file'
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
      eventStore.append(
        sessionId,
        createMessageStartEvent(
          errorMsgId,
          'user',
          `Access denied: ${error.paths.join(', ')}. If you need this file, explain why and ask the user for permission.`,
          {
            ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
            isSystemGenerated: true,
            messageKind: 'correction',
          },
        ),
      )
      eventStore.append(sessionId, createChatDoneEvent(errorMsgId, 'error'))
      return
    }

    if (error instanceof Error && error.message === 'Aborted') {
      try {
        const snapshot = buildSnapshot(sessionManager, sessionId, turnMetrics.buildStats(statsIdentity, mode))
        eventStore.append(sessionId, { type: 'turn.snapshot', data: snapshot })
      } catch {
        // Session may have been deleted during abort — skip cleanup
      }
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
    eventStore.append(
      sessionId,
      createMessageStartEvent(
        errorMsgId,
        'user',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
          isSystemGenerated: true,
          messageKind: 'correction',
        },
      ),
    )
    eventStore.append(sessionId, createChatDoneEvent(errorMsgId, 'error'))
  } finally {
    try {
      eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: false } })
    } catch {
      // Session may have been deleted
    }
  }
}

// ============================================================================
// Generic Agent Turn (works for planner, custom agents, etc.)
// ============================================================================

/**
 * Inject agent reminder at the start of a turn.
 *
 * Scans events from end to find the latest agent message in the current
 * context window. If found with the same agent name → injects a small
 * reminder ("Reminder: you are in 'X' mode."). Otherwise → injects the
 * full agent definition (prompt + tool permissions).
 *
 * Always appends — never skips. Ground truth from events only, no
 * in-memory state tracking.
 */
function injectAgentReminder(sessionId: string, agentDef: AgentDefinition): void {
  const eventStore = getEventStore()
  const currentWindowId = getCurrentContextWindowId(sessionId)

  // Scan from end for latest agent message in current window.
  // getAllEvents returns both real events and synthetic events reconstructed
  // from the snapshot, so we always have the full history regardless of cleanup.
  let latestAgentName: string | undefined
  const events = eventStore.getAllEvents(sessionId)
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.type === 'message.start') {
      const data = event.data as {
        isSystemGenerated?: boolean
        metadata?: { type?: string; name?: string }
        contextWindowId?: string
      }
      if (
        data.isSystemGenerated &&
        data.metadata?.type === 'agent' &&
        (data.contextWindowId === currentWindowId || (!currentWindowId && !data.contextWindowId))
      ) {
        latestAgentName = data.metadata.name
        break
      }
    }
  }

  const currentAgentName = agentDef.metadata.name ?? agentDef.metadata.id

  const isSmallReminder = latestAgentName === currentAgentName
  const content = isSmallReminder ? buildAgentSmallReminder(currentAgentName) : buildAgentReminder(agentDef)

  const reminderMsgId = crypto.randomUUID()
  const currentWindowMessageOptions = currentWindowId ? { contextWindowId: currentWindowId } : undefined

  eventStore.append(sessionId, {
    type: 'message.start',
    data: {
      messageId: reminderMsgId,
      role: 'user',
      content,
      ...(currentWindowMessageOptions ?? {}),
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      metadata: {
        type: 'agent',
        name: currentAgentName,
        color: agentDef.metadata.color ?? '#6b7280',
        kind: isSmallReminder ? 'reminder' : 'definition',
      },
    },
  })
  eventStore.append(sessionId, {
    type: 'message.done',
    data: { messageId: reminderMsgId },
  })
}

export async function runAgentTurn(
  options: OrchestratorOptions,
  turnMetrics: TurnMetrics,
  agentId: string,
  append: (event: import('../events/types.js').TurnEvent) => void,
  callbacks?: {
    injectKickoff?: () => void
    onToolExecuted?: (toolCall: ToolCall, toolResult: ToolResult) => void
  },
): Promise<{ returnValueContent?: string; returnValueResult?: string }> {
  const statsIdentity = resolveStatsIdentity(options)
  const allAgents = await loadAllAgentsDefault()
  const agentDef = findAgentById(agentId, allAgents) ?? findAgentById('planner', allAgents)!

  if (!options.warmup) {
    injectAgentReminder(options.sessionId, agentDef)
  }

  const { content: instructionContent } = await getAllInstructions(
    options.sessionManager.requireSession(options.sessionId).workdir,
    options.sessionManager.requireSession(options.sessionId).projectId,
  )
  const runtimeConfig = getRuntimeConfig()
  const configDir = getGlobalConfigDir(runtimeConfig.mode ?? 'production')
  const skills = await getEnabledSkillMetadata(configDir, runtimeConfig.workdir)

  return runTopLevelAgentLoop(
    {
      mode: agentId,
      append,
      ...(await buildRetryPatterns()),
      sessionManager: options.sessionManager,
      sessionId: options.sessionId,
      llmClient: options.llmClient,
      statsIdentity,
      signal: options.signal,
      onMessage: options.onMessage,
      assembleRequest: async (input) => {
        const cached = options.sessionManager.getCachedPrompt(options.sessionId)
        if (cached) {
          const toolFingerprint = getToolFingerprint(cached.tools)
          const currentHash = computeDynamicContextHash(instructionContent ?? '', skills, toolFingerprint)
          if (cached.hash !== currentHash) {
            logger.debug('assembleRequest: hash mismatch', {
              sessionId: options.sessionId,
              cachedHash: cached.hash,
              currentHash,
              cachedTools: cached.tools.map((t) => t.function.name),
            })
            options.sessionManager.setDynamicContextChanged(options.sessionId, true)
          }
          return createAssemblyResult({
            systemPrompt: cached.systemPrompt,
            messages: input.messages,
            injectedFiles: input.injectedFiles,
            requestTools: cached.tools,
            toolChoice: input.toolChoice,
          })
        }
        const result = await buildCachedPrompt(options.sessionManager, options.sessionId, agentDef)
        options.sessionManager.setCachedPrompt(options.sessionId, result.systemPrompt, result.tools, result.hash)
        return createAssemblyResult({
          systemPrompt: result.systemPrompt,
          messages: input.messages,
          injectedFiles: input.injectedFiles,
          requestTools: result.tools,
          toolChoice: input.toolChoice,
        })
      },
      getToolRegistry: () => getToolRegistryForAgent(agentDef),
      getConversationMessages: buildGetConversationMessages(options.sessionId, options.llmClient, append),
      injectAgentReminder: () => injectAgentReminder(options.sessionId, agentDef),
      ...(options.initialCompacting ? { initialCompacting: true } : {}),
      ...(callbacks?.injectKickoff ? { injectKickoff: callbacks.injectKickoff } : {}),
      ...(callbacks?.onToolExecuted ? { onToolExecuted: callbacks.onToolExecuted } : {}),
      ...(options.warmup ? { warmup: true } : {}),
    },
    turnMetrics,
  )
}

// ============================================================================
// Shared Helpers
// ============================================================================

/**
 * Build a snapshot of current session state.
 */
function buildSnapshot(sessionManager: SessionManager, sessionId: string, _lastStats?: MessageStats): SessionSnapshot {
  const eventStore = getEventStore()
  const session = sessionManager.requireSession(sessionId)
  const events = eventStore.getEvents(sessionId)
  const latestSeq = eventStore.getLatestSeq(sessionId) ?? 0
  const cachedPrompt = sessionManager.getCachedPrompt(sessionId)

  return buildSnapshotFromSessionState({
    session,
    events,
    latestSeq,
    ...(cachedPrompt ? { cachedSystemPrompt: cachedPrompt.systemPrompt, dynamicContextHash: cachedPrompt.hash } : {}),
  })
}
