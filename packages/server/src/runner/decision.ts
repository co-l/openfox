/**
 * Decision function for the runner state machine.
 * Pure function: takes criteria, returns the next action to take.
 */

import type { Criterion } from '@openfox/shared'
import type { NextAction } from './types.js'
import { RUNNER_CONFIG } from './types.js'

/**
 * Decide the next action based on current criteria state.
 * 
 * Priority order:
 * 1. BLOCKED - if any criterion hit retry limit
 * 2. DONE - if all criteria passed (or no criteria)
 * 3. RUN_VERIFIER - if all criteria are completed/passed
 * 4. RUN_BUILDER - otherwise (pending, in_progress, or failed under limit)
 */
export function decideNextAction(criteria: Criterion[]): NextAction {
  // 1. Check for blocked criteria (hit retry limit)
  const blockedCriteria = criteria.filter(c => 
    c.status.type === 'failed' &&
    c.attempts.filter(a => a.status === 'failed').length >= RUNNER_CONFIG.maxVerifyRetries
  )
  
  if (blockedCriteria.length > 0) {
    const ids = blockedCriteria.map(c => c.id)
    return {
      type: 'BLOCKED',
      reason: `Retry limit reached for: ${ids.join(', ')}`,
      blockedCriteria: ids,
    }
  }
  
  // 2. Check if all passed (or no criteria)
  const allPassed = criteria.length === 0 || criteria.every(c => c.status.type === 'passed')
  
  if (allPassed) {
    return { type: 'DONE' }
  }
  
  // 3. Check if all are completed or passed (ready for verification)
  const allCompletedOrPassed = criteria.every(c => 
    c.status.type === 'completed' || c.status.type === 'passed'
  )
  
  if (allCompletedOrPassed) {
    const toVerify = criteria
      .filter(c => c.status.type === 'completed')
      .map(c => c.id)
    
    return {
      type: 'RUN_VERIFIER',
      criteriaToVerify: toVerify,
    }
  }
  
  // 4. Otherwise, keep building
  const remaining = criteria.filter(c => c.status.type !== 'passed')
  
  return {
    type: 'RUN_BUILDER',
    reason: `${remaining.length} criteria remaining`,
  }
}
