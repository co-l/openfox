/**
 * Runner Orchestrator (EventStore Version)
 * 
 * Coordinates the build → verify → done/blocked cycle.
 * Uses decideNextAction() to determine what to do next,
 * then calls the appropriate worker function.
 * 
 * All events are appended to EventStore - no onMessage callback needed.
 */

import type { OrchestratorOptions, OrchestratorResult } from './types.js'
import { RUNNER_CONFIG } from './types.js'
import { decideNextAction } from './decision.js'
import { sessionManager } from '../session/index.js'
import { getEventStore } from '../events/index.js'
import { logger } from '../utils/logger.js'

// Import from chat orchestrator (EventStore-based)
import { runBuilderTurn, runVerifierTurn, TurnMetrics, createMessageStartEvent } from '../chat/orchestrator.js'
import type { LLMClientWithModel } from '../llm/client.js'

/**
 * Run the orchestrator loop until done, blocked, or aborted.
 * 
 * This is the main entry point for the "Launch" button.
 * It keeps calling builder/verifier until all criteria pass.
 */
export async function runOrchestrator(options: OrchestratorOptions): Promise<OrchestratorResult> {
  const { sessionId, llmClient, signal, onMessage } = options
  const eventStore = getEventStore()
  const startTime = performance.now()
  let iterations = 0
  
  logger.debug('Orchestrator starting', { sessionId })
  
  while (iterations < RUNNER_CONFIG.maxIterations) {
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
    const action = decideNextAction(session.criteria)
    
    logger.debug('Orchestrator decision', { sessionId, iteration: iterations, action: action.type })
    
    switch (action.type) {
      case 'DONE': {
        sessionManager.setPhase(sessionId, 'done')
        eventStore.append(sessionId, { type: 'phase.changed', data: { phase: 'done' } })
        logger.debug('Orchestrator complete', { sessionId, iterations })
        return {
          finalAction: action,
          iterations,
          totalTime: (performance.now() - startTime) / 1000,
        }
      }
      
      case 'BLOCKED': {
        sessionManager.setPhase(sessionId, 'blocked')
        eventStore.append(sessionId, { type: 'phase.changed', data: { phase: 'blocked' } })
        
        // Inject message explaining why blocked
        const blockedMsgId = crypto.randomUUID()
        eventStore.append(sessionId, createMessageStartEvent(blockedMsgId, 'user', `Runner blocked: ${action.reason}`, {
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
        eventStore.append(sessionId, { type: 'phase.changed', data: { phase: 'verification' } })
        
        // Run verification step
        const turnMetrics = new TurnMetrics()
        await runVerifierTurn({ sessionId, llmClient, ...(signal ? { signal } : {}), ...(onMessage ? { onMessage } : {}) }, turnMetrics)
        
        // Loop continues to check result
        break
      }
      
      case 'RUN_BUILDER': {
        sessionManager.setPhase(sessionId, 'build')
        eventStore.append(sessionId, { type: 'phase.changed', data: { phase: 'build' } })
        
        // Inject nudge message if this is a retry (not first iteration)
        if (iterations > 1) {
          const nudgeMsgId = crypto.randomUUID()
          eventStore.append(sessionId, createMessageStartEvent(nudgeMsgId, 'user', `Continue working on the acceptance criteria. ${action.reason}.`, {
            isSystemGenerated: true,
            messageKind: 'correction',
          }))
          eventStore.append(sessionId, { type: 'message.done', data: { messageId: nudgeMsgId } })
        }
        
        // Run builder step
        const turnMetrics = new TurnMetrics()
        await runBuilderTurn({ sessionId, llmClient, ...(signal ? { signal } : {}), ...(onMessage ? { onMessage } : {}) }, turnMetrics)
        
        // Loop continues to check if more work needed
        break
      }
    }
  }
  
  // Max iterations reached
  logger.warn('Orchestrator max iterations reached', { sessionId, iterations })
  const maxIterAction = { type: 'BLOCKED' as const, reason: 'Max iterations reached', blockedCriteria: [] }
  
  sessionManager.setPhase(sessionId, 'blocked')
  eventStore.append(sessionId, { type: 'phase.changed', data: { phase: 'blocked' } })
  
  const maxIterMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(maxIterMsgId, 'user', `Runner stopped: Maximum iterations (${RUNNER_CONFIG.maxIterations}) reached`, {
    isSystemGenerated: true,
    messageKind: 'correction',
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: maxIterMsgId } })
  
  return {
    finalAction: maxIterAction,
    iterations,
    totalTime: (performance.now() - startTime) / 1000,
  }
}
