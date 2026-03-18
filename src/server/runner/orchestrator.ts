/**
 * Runner Orchestrator
 * 
 * Coordinates the build → verify → done/blocked cycle.
 * Uses decideNextAction() to determine what to do next,
 * then calls the appropriate worker function.
 * 
 * Each worker (builder, verifier) handles its own stats emission
 * following the PROMPT -> WORK -> stats+sound pattern.
 */

import type { ServerMessage } from '../../shared/protocol.js'
import type { OrchestratorOptions, OrchestratorResult } from './types.js'
import { RUNNER_CONFIG } from './types.js'
import { decideNextAction } from './decision.js'
import { sessionManager } from '../session/index.js'
import { estimateTokens } from '../context/tokenizer.js'
import { logger } from '../utils/logger.js'
import {
  createChatMessageMessage,
  createPhaseChangedMessage,
} from '../ws/protocol.js'

// Import worker functions
import { runBuilderStep } from '../chat/builder.js'
import { runVerifierStep } from '../chat/verifier.js'

/**
 * Run the orchestrator loop until done, blocked, or aborted.
 * 
 * This is the main entry point for the "Launch" button.
 * It keeps calling builder/verifier until all criteria pass.
 */
export async function runOrchestrator(options: OrchestratorOptions): Promise<OrchestratorResult> {
  const { sessionId, llmClient, signal, onMessage } = options
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
        onMessage(createPhaseChangedMessage('done'))
        logger.debug('Orchestrator complete', { sessionId, iterations })
        return {
          finalAction: action,
          iterations,
          totalTime: (performance.now() - startTime) / 1000,
        }
      }
      
      case 'BLOCKED': {
        sessionManager.setPhase(sessionId, 'blocked')
        onMessage(createPhaseChangedMessage('blocked'))
        
        // Inject message explaining why blocked
        const blockedMsg = sessionManager.addMessage(sessionId, {
          role: 'user',
          content: `Runner blocked: ${action.reason}`,
          tokenCount: estimateTokens(action.reason),
          isSystemGenerated: true,
          messageKind: 'correction',
        })
        onMessage(createChatMessageMessage(blockedMsg))
        
        logger.warn('Orchestrator blocked', { sessionId, iterations, reason: action.reason })
        return {
          finalAction: action,
          iterations,
          totalTime: (performance.now() - startTime) / 1000,
        }
      }
      
      case 'RUN_VERIFIER': {
        sessionManager.setPhase(sessionId, 'verification')
        onMessage(createPhaseChangedMessage('verification'))
        
        // Run verification step (emits its own stats+chat.done)
        await runVerifierStep({
          sessionId,
          llmClient,
          onMessage,
          ...(signal ? { signal } : {}),
        })
        
        // Loop continues to check result
        break
      }
      
      case 'RUN_BUILDER': {
        sessionManager.setPhase(sessionId, 'build')
        onMessage(createPhaseChangedMessage('build'))
        
        // Inject nudge message if this is a retry (not first iteration)
        if (iterations > 1) {
          const nudgeMsg = sessionManager.addMessage(sessionId, {
            role: 'user',
            content: `Continue working on the acceptance criteria. ${action.reason}.`,
            tokenCount: 30,
            isSystemGenerated: true,
            messageKind: 'correction',
          })
          onMessage(createChatMessageMessage(nudgeMsg))
        }
        
        // Run builder step (emits its own stats+chat.done)
        await runBuilderStep({
          sessionId,
          llmClient,
          onMessage,
          ...(signal ? { signal } : {}),
        })
        
        // Loop continues to check if more work needed
        break
      }
    }
  }
  
  // Max iterations reached
  logger.warn('Orchestrator max iterations reached', { sessionId, iterations })
  const maxIterAction = { type: 'BLOCKED' as const, reason: 'Max iterations reached', blockedCriteria: [] }
  
  sessionManager.setPhase(sessionId, 'blocked')
  onMessage(createPhaseChangedMessage('blocked'))
  
  const msg = sessionManager.addMessage(sessionId, {
    role: 'user',
    content: `Runner stopped: Maximum iterations (${RUNNER_CONFIG.maxIterations}) reached`,
    tokenCount: 20,
    isSystemGenerated: true,
    messageKind: 'correction',
  })
  onMessage(createChatMessageMessage(msg))
  
  return {
    finalAction: maxIterAction,
    iterations,
    totalTime: (performance.now() - startTime) / 1000,
  }
}
