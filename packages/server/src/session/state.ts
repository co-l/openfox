import type { SessionPhase } from '@openfox/shared'
import { InvalidPhaseTransitionError } from '../utils/errors.js'

// Valid phase transitions
const TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  idle: ['planning'],
  planning: ['executing', 'idle'],
  executing: ['validating', 'planning', 'idle'],
  validating: ['completed', 'executing'],
  completed: ['planning', 'idle'],
}

export function canTransition(from: SessionPhase, to: SessionPhase): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertTransition(from: SessionPhase, to: SessionPhase): void {
  if (!canTransition(from, to)) {
    throw new InvalidPhaseTransitionError(from, to)
  }
}

export function getNextPhases(current: SessionPhase): SessionPhase[] {
  return TRANSITIONS[current]
}

// Phase requirements
export interface PhaseRequirements {
  planning: { hasUserMessage: boolean }
  executing: { hasCriteria: boolean }
  validating: { allCriteriaAddressed: boolean }
  completed: { validationPassed: boolean }
}

export function checkPhaseRequirements(
  targetPhase: SessionPhase,
  context: {
    messageCount: number
    criteriaCount: number
    criteriaAddressed: number
    validationPassed: boolean
  }
): { canEnter: boolean; reason?: string } {
  switch (targetPhase) {
    case 'planning':
      return { canEnter: true }
    
    case 'executing':
      if (context.criteriaCount === 0) {
        return { canEnter: false, reason: 'At least one criterion required' }
      }
      return { canEnter: true }
    
    case 'validating':
      if (context.criteriaAddressed < context.criteriaCount) {
        return { 
          canEnter: false, 
          reason: `${context.criteriaCount - context.criteriaAddressed} criteria not addressed` 
        }
      }
      return { canEnter: true }
    
    case 'completed':
      if (!context.validationPassed) {
        return { canEnter: false, reason: 'Validation must pass' }
      }
      return { canEnter: true }
    
    case 'idle':
      return { canEnter: true }
  }
}
