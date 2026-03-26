/**
 * Runner Orchestrator (EventStore Version)
 *
 * Coordinates the build → verify → done/blocked cycle.
 *
 * If an active workflow is configured, delegates to the workflow executor
 * (state machine driven). Otherwise falls back to the hardcoded
 * decideNextAction() loop.
 *
 * All events are appended to EventStore - no onMessage callback needed.
 */

import type { OrchestratorOptions, OrchestratorResult } from './types.js'
import { decideNextAction } from './decision.js'
import { getEventStore, getCurrentContextWindowId } from '../events/index.js'
import { logger } from '../utils/logger.js'
import { computeSessionStats } from '../../shared/stats.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { loadAllWorkflows, findWorkflowById } from '../workflows/registry.js'
import { executeWorkflow } from '../workflows/executor.js'

// Import from chat orchestrator (EventStore-based)
import { runBuilderTurn, runVerifierTurn, TurnMetrics, createMessageStartEvent } from '../chat/orchestrator.js'

function getCurrentWindowMessageOptions(sessionId: string): { contextWindowId: string } | undefined {
  const contextWindowId = getCurrentContextWindowId(sessionId)
  return contextWindowId ? { contextWindowId } : undefined
}

/**
 * Run the orchestrator loop until done, blocked, or aborted.
 *
 * This is the main entry point for the "Launch" button.
 * It keeps calling builder/verifier until all criteria pass.
 */
export async function runOrchestrator(options: OrchestratorOptions): Promise<OrchestratorResult> {
  // Try workflow-driven execution first
  const runtimeConfig = getRuntimeConfig()
  const activeWorkflowId = runtimeConfig.activeWorkflowId ?? 'default'
  const configDir = getGlobalConfigDir(runtimeConfig.mode ?? 'production')

  try {
    const workflows = await loadAllWorkflows(configDir)
    const workflow = findWorkflowById(activeWorkflowId, workflows)

    if (workflow) {
      logger.debug('Using workflow executor', { sessionId: options.sessionId, workflow: workflow.metadata.id })
      return await executeWorkflow(workflow, options)
    }
  } catch (err) {
    logger.warn('Failed to load workflow, falling back to hardcoded loop', {
      workflowId: activeWorkflowId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Fallback: hardcoded build → verify → done/blocked loop
  return runHardcodedLoop(options)
}

async function runHardcodedLoop(options: OrchestratorOptions): Promise<OrchestratorResult> {
  const { sessionManager, sessionId, llmClient, signal, onMessage } = options
  const eventStore = getEventStore()
  const startTime = performance.now()
  let iterations = 0
  let lastVerifierContent: string | null = null

  logger.debug('Orchestrator starting (hardcoded loop)', { sessionId })

  while (true) {
    // Check abort signal
    if (signal?.aborted) {
      logger.debug('Orchestrator aborted', { sessionId, iterations })
      return {
        finalAction: { type: 'RUN_BUILDER', reason: 'Aborted' },
        iterations,
        totalTime: (performance.now() - startTime) / 1000,
      }
    }

    iterations++

    // Get current session state and decide next action
    const session = sessionManager.requireSession(sessionId)
    const currentWindowMessageOptions = getCurrentWindowMessageOptions(sessionId)
    const action = decideNextAction(session.criteria)

    logger.debug('Orchestrator decision', { sessionId, iteration: iterations, action: action.type })

    switch (action.type) {
      case 'DONE': {
        sessionManager.setPhase(sessionId, 'done')

        // Emit task.completed event with summary stats
        const totalTimeSeconds = Math.round((performance.now() - startTime) / 100) / 10
        const completedSession = sessionManager.requireSession(sessionId)
        const sessionStats = computeSessionStats(completedSession.messages)
        // Count tool calls from assistant messages (metadata counter is unused)
        const totalToolCalls = completedSession.messages.reduce(
          (sum, m) => sum + (m.toolCalls?.length ?? 0), 0
        )
        const taskCompletedData = {
          summary: completedSession.summary,
          iterations,
          totalTimeSeconds,
          totalToolCalls,
          totalTokensGenerated: sessionStats?.generationTokens ?? 0,
          avgGenerationSpeed: sessionStats?.avgGenerationSpeed ?? 0,
          responseCount: sessionStats?.responseCount ?? 0,
          llmCallCount: sessionStats?.llmCallCount ?? 0,
          criteria: completedSession.criteria.map(c => ({
            id: c.id,
            description: c.description,
            status: c.status.type,
          })),
        }
        eventStore.append(sessionId, { type: 'task.completed', data: taskCompletedData })

        // Emit a marker message so the card has a natural position in the timeline
        const markerMsgId = crypto.randomUUID()
        eventStore.append(sessionId, createMessageStartEvent(markerMsgId, 'user', JSON.stringify(taskCompletedData), {
          ...(currentWindowMessageOptions ?? {}),
          isSystemGenerated: true,
          messageKind: 'task-completed',
        }))
        eventStore.append(sessionId, { type: 'message.done', data: { messageId: markerMsgId } })

        logger.debug('Orchestrator complete', { sessionId, iterations })
        return {
          finalAction: action,
          iterations,
          totalTime: totalTimeSeconds,
        }
      }

      case 'BLOCKED': {
        sessionManager.setPhase(sessionId, 'blocked')

        // Inject message explaining why blocked
        const blockedMsgId = crypto.randomUUID()
        eventStore.append(sessionId, createMessageStartEvent(blockedMsgId, 'user', `Runner blocked: ${action.reason}`, {
          ...(currentWindowMessageOptions ?? {}),
          isSystemGenerated: true,
          messageKind: 'correction',
        }))
        eventStore.append(sessionId, { type: 'message.done', data: { messageId: blockedMsgId } })

        logger.warn('Orchestrator blocked', { sessionId, iterations, reason: action.reason })
        return {
          finalAction: action,
          iterations,
          totalTime: (performance.now() - startTime) / 1000,
        }
      }

      case 'RUN_VERIFIER': {
        sessionManager.setPhase(sessionId, 'verification')

        // Run verification step
        const turnMetrics = new TurnMetrics()
        const verifierResult = await runVerifierTurn({ sessionManager, sessionId, llmClient, ...(options.statsIdentity ? { statsIdentity: options.statsIdentity } : {}), ...(signal ? { signal } : {}), ...(onMessage ? { onMessage } : {}) }, turnMetrics)
        lastVerifierContent = verifierResult.content ?? null

        // Loop continues to check result
        break
      }

      case 'RUN_BUILDER': {
        sessionManager.setPhase(sessionId, 'build')

        // Inject nudge message if this is a retry (not first iteration)
        if (iterations > 1) {
          const verifierDetail = lastVerifierContent
            ? `\n\nVerifier findings:\n${lastVerifierContent}`
            : ''
          lastVerifierContent = null
          const nudgeMsgId = crypto.randomUUID()
          eventStore.append(sessionId, createMessageStartEvent(nudgeMsgId, 'user', `Continue working on the acceptance criteria.
${action.reason}.${verifierDetail}
Don't forget to mark the criteria as complete with complete_criterion`, {
            ...(currentWindowMessageOptions ?? {}),
            isSystemGenerated: true,
            messageKind: 'correction',
          }))
          eventStore.append(sessionId, { type: 'message.done', data: { messageId: nudgeMsgId } })
        }

        // Run builder step
        const turnMetrics = new TurnMetrics()
        await runBuilderTurn({
          sessionManager,
          sessionId,
          llmClient,
          ...(options.statsIdentity ? { statsIdentity: options.statsIdentity } : {}),
          ...(options.injectBuilderKickoff === true ? { injectBuilderKickoff: true } : {}),
          ...(signal ? { signal } : {}),
          ...(onMessage ? { onMessage } : {}),
        }, turnMetrics)

        // Loop continues to check if more work needed
        break
      }
    }
  }
}
