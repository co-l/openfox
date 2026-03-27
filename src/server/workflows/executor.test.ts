/**
 * Workflow Executor – Pure Function Tests
 */

import { describe, it, expect } from 'vitest'
import type { Criterion } from '../../shared/types.js'
import type { TransitionCondition, Transition } from './types.js'
import { TERMINAL_BLOCKED, TERMINAL_DONE } from './types.js'
import { RUNNER_CONFIG } from '../runner/types.js'
import {
  evaluateCondition,
  evaluateTransitions,
  resolveTemplate,
  formatCriteriaList,
  formatModifiedFiles,
  buildReason,
} from './executor.js'
import type { TemplateContext, StepOutcome } from './executor.js'
import type { Session } from '../../shared/types.js'

// ============================================================================
// Helpers
// ============================================================================

function makeCriterion(overrides: Partial<Criterion> = {}): Criterion {
  return {
    id: 'c1',
    description: 'Test criterion',
    status: { type: 'pending' },
    attempts: [],
    ...overrides,
  }
}

function makeTemplateContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    workdir: '/tmp/project',
    reason: '2 criteria remaining',
    verifierFindings: 'Some findings',
    previousStepOutput: 'exit 0',
    criteriaCount: 3,
    pendingCount: 2,
    summary: 'Build a widget',
    criteriaList: '- c1 [PASSED]: do thing',
    modifiedFiles: '- src/index.ts',
    ...overrides,
  }
}

// ============================================================================
// evaluateCondition
// ============================================================================

describe('evaluateCondition', () => {
  describe('all_criteria_passed', () => {
    const condition: TransitionCondition = { type: 'all_criteria_passed' }

    it('returns true when criteria list is empty', () => {
      expect(evaluateCondition(condition, [], null)).toBe(true)
    })

    it('returns true when all criteria are passed', () => {
      const criteria = [
        makeCriterion({ id: 'c1', status: { type: 'passed', verifiedAt: '2025-01-01' } }),
        makeCriterion({ id: 'c2', status: { type: 'passed', verifiedAt: '2025-01-01' } }),
      ]
      expect(evaluateCondition(condition, criteria, null)).toBe(true)
    })

    it('returns false when some criteria are pending', () => {
      const criteria = [
        makeCriterion({ id: 'c1', status: { type: 'passed', verifiedAt: '2025-01-01' } }),
        makeCriterion({ id: 'c2', status: { type: 'pending' } }),
      ]
      expect(evaluateCondition(condition, criteria, null)).toBe(false)
    })

    it('returns false when some criteria are completed but not passed', () => {
      const criteria = [
        makeCriterion({ id: 'c1', status: { type: 'completed', completedAt: '2025-01-01' } }),
      ]
      expect(evaluateCondition(condition, criteria, null)).toBe(false)
    })
  })

  describe('all_criteria_completed_or_passed', () => {
    const condition: TransitionCondition = { type: 'all_criteria_completed_or_passed' }

    it('returns true when all criteria are completed or passed', () => {
      const criteria = [
        makeCriterion({ id: 'c1', status: { type: 'passed', verifiedAt: '2025-01-01' } }),
        makeCriterion({ id: 'c2', status: { type: 'completed', completedAt: '2025-01-01' } }),
      ]
      expect(evaluateCondition(condition, criteria, null)).toBe(true)
    })

    it('returns true when empty', () => {
      expect(evaluateCondition(condition, [], null)).toBe(true)
    })

    it('returns false when some criteria are pending', () => {
      const criteria = [
        makeCriterion({ id: 'c1', status: { type: 'completed', completedAt: '2025-01-01' } }),
        makeCriterion({ id: 'c2', status: { type: 'pending' } }),
      ]
      expect(evaluateCondition(condition, criteria, null)).toBe(false)
    })

    it('returns false when some criteria are failed', () => {
      const criteria = [
        makeCriterion({ id: 'c1', status: { type: 'failed', reason: 'bad', failedAt: '2025-01-01' } }),
      ]
      expect(evaluateCondition(condition, criteria, null)).toBe(false)
    })
  })

  describe('any_criteria_blocked', () => {
    const condition: TransitionCondition = { type: 'any_criteria_blocked' }

    it('returns true when a criterion has maxVerifyRetries failed attempts', () => {
      const failedAttempts = Array.from({ length: RUNNER_CONFIG.maxVerifyRetries }, (_, i) => ({
        attemptNumber: i + 1,
        status: 'failed' as const,
        timestamp: '2025-01-01',
      }))
      const criteria = [
        makeCriterion({
          id: 'c1',
          status: { type: 'failed', reason: 'bad', failedAt: '2025-01-01' },
          attempts: failedAttempts,
        }),
      ]
      expect(evaluateCondition(condition, criteria, null)).toBe(true)
    })

    it('returns false when no criterion has enough failed attempts', () => {
      const criteria = [
        makeCriterion({
          id: 'c1',
          status: { type: 'failed', reason: 'bad', failedAt: '2025-01-01' },
          attempts: [{ attemptNumber: 1, status: 'failed', timestamp: '2025-01-01' }],
        }),
      ]
      expect(evaluateCondition(condition, criteria, null)).toBe(false)
    })

    it('returns false when criteria are not in failed status', () => {
      const criteria = [
        makeCriterion({ id: 'c1', status: { type: 'pending' } }),
      ]
      expect(evaluateCondition(condition, criteria, null)).toBe(false)
    })

    it('returns false for empty criteria', () => {
      expect(evaluateCondition(condition, [], null)).toBe(false)
    })
  })

  describe('has_pending_criteria', () => {
    const condition: TransitionCondition = { type: 'has_pending_criteria' }

    it('returns true when any criterion is not passed', () => {
      const criteria = [
        makeCriterion({ id: 'c1', status: { type: 'passed', verifiedAt: '2025-01-01' } }),
        makeCriterion({ id: 'c2', status: { type: 'pending' } }),
      ]
      expect(evaluateCondition(condition, criteria, null)).toBe(true)
    })

    it('returns true when a criterion is completed but not passed', () => {
      const criteria = [
        makeCriterion({ id: 'c1', status: { type: 'completed', completedAt: '2025-01-01' } }),
      ]
      expect(evaluateCondition(condition, criteria, null)).toBe(true)
    })

    it('returns false when all criteria are passed', () => {
      const criteria = [
        makeCriterion({ id: 'c1', status: { type: 'passed', verifiedAt: '2025-01-01' } }),
        makeCriterion({ id: 'c2', status: { type: 'passed', verifiedAt: '2025-01-01' } }),
      ]
      expect(evaluateCondition(condition, criteria, null)).toBe(false)
    })

    it('returns false for empty criteria', () => {
      expect(evaluateCondition(condition, [], null)).toBe(false)
    })
  })

  describe('step_result', () => {
    it('returns true when condition is success and step succeeded', () => {
      const condition: TransitionCondition = { type: 'step_result', result: 'success' }
      expect(evaluateCondition(condition, [], { success: true })).toBe(true)
    })

    it('returns false when condition is success and step failed', () => {
      const condition: TransitionCondition = { type: 'step_result', result: 'success' }
      expect(evaluateCondition(condition, [], { success: false })).toBe(false)
    })

    it('returns true when condition is failure and step failed', () => {
      const condition: TransitionCondition = { type: 'step_result', result: 'failure' }
      expect(evaluateCondition(condition, [], { success: false })).toBe(true)
    })

    it('returns false when condition is failure and step succeeded', () => {
      const condition: TransitionCondition = { type: 'step_result', result: 'failure' }
      expect(evaluateCondition(condition, [], { success: true })).toBe(false)
    })

    it('returns false when stepOutcome is null', () => {
      const condition: TransitionCondition = { type: 'step_result', result: 'success' }
      expect(evaluateCondition(condition, [], null)).toBe(false)
    })
  })

  describe('always', () => {
    it('always returns true', () => {
      const condition: TransitionCondition = { type: 'always' }
      expect(evaluateCondition(condition, [], null)).toBe(true)
    })

    it('returns true regardless of criteria state', () => {
      const condition: TransitionCondition = { type: 'always' }
      const criteria = [makeCriterion({ id: 'c1', status: { type: 'pending' } })]
      expect(evaluateCondition(condition, criteria, null)).toBe(true)
    })
  })
})

// ============================================================================
// evaluateTransitions
// ============================================================================

describe('evaluateTransitions', () => {
  it('returns goto of the first matching transition', () => {
    const transitions: Transition[] = [
      { when: { type: 'all_criteria_passed' }, goto: TERMINAL_DONE },
      { when: { type: 'always' }, goto: 'build' },
    ]
    // All passed => first transition matches
    const criteria = [
      makeCriterion({ id: 'c1', status: { type: 'passed', verifiedAt: '2025-01-01' } }),
    ]
    expect(evaluateTransitions(transitions, criteria, null)).toBe(TERMINAL_DONE)
  })

  it('skips non-matching transitions and picks the first match', () => {
    const transitions: Transition[] = [
      { when: { type: 'all_criteria_passed' }, goto: TERMINAL_DONE },
      { when: { type: 'has_pending_criteria' }, goto: 'build' },
      { when: { type: 'always' }, goto: 'fallback' },
    ]
    const criteria = [
      makeCriterion({ id: 'c1', status: { type: 'pending' } }),
    ]
    expect(evaluateTransitions(transitions, criteria, null)).toBe('build')
  })

  it('returns TERMINAL_BLOCKED when no transitions match', () => {
    const transitions: Transition[] = [
      { when: { type: 'all_criteria_passed' }, goto: TERMINAL_DONE },
    ]
    const criteria = [
      makeCriterion({ id: 'c1', status: { type: 'pending' } }),
    ]
    expect(evaluateTransitions(transitions, criteria, null)).toBe(TERMINAL_BLOCKED)
  })

  it('returns TERMINAL_BLOCKED for empty transitions array', () => {
    expect(evaluateTransitions([], [], null)).toBe(TERMINAL_BLOCKED)
  })

  it('uses stepOutcome for step_result conditions', () => {
    const transitions: Transition[] = [
      { when: { type: 'step_result', result: 'success' }, goto: 'verify' },
      { when: { type: 'step_result', result: 'failure' }, goto: 'retry' },
    ]
    expect(evaluateTransitions(transitions, [], { success: false })).toBe('retry')
  })
})

// ============================================================================
// resolveTemplate
// ============================================================================

describe('resolveTemplate', () => {
  it('replaces all template variables', () => {
    const ctx = makeTemplateContext()
    const template = 'Dir: {{workdir}}, Reason: {{reason}}, Findings: {{verifierFindings}}, ' +
      'Prev: {{previousStepOutput}}, Count: {{criteriaCount}}, Pending: {{pendingCount}}, ' +
      'Summary: {{summary}}, List: {{criteriaList}}, Files: {{modifiedFiles}}'

    const result = resolveTemplate(template, ctx)

    expect(result).toBe(
      'Dir: /tmp/project, Reason: 2 criteria remaining, Findings: Some findings, ' +
      'Prev: exit 0, Count: 3, Pending: 2, ' +
      'Summary: Build a widget, List: - c1 [PASSED]: do thing, Files: - src/index.ts'
    )
  })

  it('handles templates with no variables (passthrough)', () => {
    const ctx = makeTemplateContext()
    const template = 'Just a plain string with no variables'
    expect(resolveTemplate(template, ctx)).toBe(template)
  })

  it('handles multiple occurrences of the same variable', () => {
    const ctx = makeTemplateContext({ workdir: '/home/user' })
    const template = 'cd {{workdir}} && ls {{workdir}}'
    expect(resolveTemplate(template, ctx)).toBe('cd /home/user && ls /home/user')
  })

  it('converts numeric values to strings', () => {
    const ctx = makeTemplateContext({ criteriaCount: 5, pendingCount: 0 })
    const template = '{{criteriaCount}} total, {{pendingCount}} pending'
    expect(resolveTemplate(template, ctx)).toBe('5 total, 0 pending')
  })
})

// ============================================================================
// formatCriteriaList
// ============================================================================

describe('formatCriteriaList', () => {
  it('returns (none) for empty criteria', () => {
    expect(formatCriteriaList([])).toBe('(none)')
  })

  it('formats each criterion with status prefix', () => {
    const criteria: Criterion[] = [
      makeCriterion({ id: 'c1', description: 'Add tests', status: { type: 'passed', verifiedAt: '2025-01-01' } }),
      makeCriterion({ id: 'c2', description: 'Fix bug', status: { type: 'completed', completedAt: '2025-01-01' } }),
      makeCriterion({ id: 'c3', description: 'Update docs', status: { type: 'failed', reason: 'bad', failedAt: '2025-01-01' } }),
      makeCriterion({ id: 'c4', description: 'Refactor', status: { type: 'pending' } }),
    ]
    const result = formatCriteriaList(criteria)
    expect(result).toBe(
      '- **c1** [PASSED]: Add tests\n' +
      '- **c2** [NEEDS VERIFICATION]: Fix bug\n' +
      '- **c3** [FAILED]: Update docs\n' +
      '- **c4** [NOT COMPLETED]: Refactor'
    )
  })

  it('formats a single criterion', () => {
    const criteria = [
      makeCriterion({ id: 'only', description: 'One thing', status: { type: 'pending' } }),
    ]
    expect(formatCriteriaList(criteria)).toBe('- **only** [NOT COMPLETED]: One thing')
  })
})

// ============================================================================
// formatModifiedFiles
// ============================================================================

describe('formatModifiedFiles', () => {
  it('returns (none) when no files are modified', () => {
    const session = { executionState: { modifiedFiles: [] } } as unknown as Session
    expect(formatModifiedFiles(session)).toBe('(none)')
  })

  it('returns (none) when executionState is undefined', () => {
    const session = {} as unknown as Session
    expect(formatModifiedFiles(session)).toBe('(none)')
  })

  it('lists files with bullet points', () => {
    const session = {
      executionState: { modifiedFiles: ['src/index.ts', 'README.md', 'package.json'] },
    } as unknown as Session
    expect(formatModifiedFiles(session)).toBe('- src/index.ts\n- README.md\n- package.json')
  })

  it('handles a single file', () => {
    const session = {
      executionState: { modifiedFiles: ['file.txt'] },
    } as unknown as Session
    expect(formatModifiedFiles(session)).toBe('- file.txt')
  })
})

// ============================================================================
// buildReason
// ============================================================================

describe('buildReason', () => {
  it('counts non-passed criteria as remaining', () => {
    const criteria = [
      makeCriterion({ id: 'c1', status: { type: 'passed', verifiedAt: '2025-01-01' } }),
      makeCriterion({ id: 'c2', status: { type: 'pending' } }),
      makeCriterion({ id: 'c3', status: { type: 'failed', reason: 'bad', failedAt: '2025-01-01' } }),
    ]
    expect(buildReason(criteria)).toBe('2 criteria remaining')
  })

  it('returns 0 when all criteria are passed', () => {
    const criteria = [
      makeCriterion({ id: 'c1', status: { type: 'passed', verifiedAt: '2025-01-01' } }),
    ]
    expect(buildReason(criteria)).toBe('0 criteria remaining')
  })

  it('handles empty criteria', () => {
    expect(buildReason([])).toBe('0 criteria remaining')
  })
})
