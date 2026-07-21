/**
 * Workflow Executor – Pure Function Tests
 */

import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MetadataEntry } from '../../shared/types.js'
import type { TransitionCondition, Transition } from './types.js'
import { TERMINAL_BLOCKED, TERMINAL_DONE } from './types.js'
import {
  evaluateCondition,
  evaluateTransitions,
  resolveTemplate,
  formatCriteriaList,
  formatModifiedFiles,
  buildReason,
} from './executor.js'
import type { TemplateContext } from './executor.js'

// ============================================================================
// Helpers
// ============================================================================

function makeMetadataEntry(overrides: Partial<MetadataEntry> = {}): MetadataEntry {
  return { id: 'c1', description: 'Test', status: 'pending', ...overrides }
}

function makeTemplateContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    workdir: '/tmp/project',
    reason: '2 criteria remaining',
    verifierFindings: 'Some findings',
    previousStepOutput: 'exit 0',
    criteriaCount: 3,
    pendingCount: 2,
    criteriaList: '- c1 [PASSED]: do thing',
    modifiedFiles: '- src/index.ts',
    stepOutput: { content: 'Some findings', stdout: 'exit 0' },
    ...overrides,
  }
}

// ============================================================================
// evaluateCondition
// ============================================================================

describe('evaluateCondition', () => {
  describe('step_result', () => {
    it('returns true when condition is success and step succeeded', () => {
      const condition: TransitionCondition = { type: 'step_result', result: 'success' }
      expect(evaluateCondition(condition, { result: 'success', output: {} })).toBe(true)
    })

    it('returns false when condition is success and step failed', () => {
      const condition: TransitionCondition = { type: 'step_result', result: 'success' }
      expect(evaluateCondition(condition, { result: 'failure', output: {} })).toBe(false)
    })

    it('returns true when condition is failure and step failed', () => {
      const condition: TransitionCondition = { type: 'step_result', result: 'failure' }
      expect(evaluateCondition(condition, { result: 'failure', output: {} })).toBe(true)
    })

    it('returns false when condition is failure and step succeeded', () => {
      const condition: TransitionCondition = { type: 'step_result', result: 'failure' }
      expect(evaluateCondition(condition, { result: 'success', output: {} })).toBe(false)
    })

    it('returns false when stepOutcome is null', () => {
      const condition: TransitionCondition = { type: 'step_result', result: 'success' }
      expect(evaluateCondition(condition, null)).toBe(false)
    })

    it('returns true when condition matches custom result string', () => {
      const condition: TransitionCondition = { type: 'step_result', result: 'passed' }
      expect(evaluateCondition(condition, { result: 'passed', output: {} })).toBe(true)
    })

    it('returns false when condition does not match custom result string', () => {
      const condition: TransitionCondition = { type: 'step_result', result: 'passed' }
      expect(evaluateCondition(condition, { result: 'failed', output: {} })).toBe(false)
    })
  })

  describe('metadata_all_match', () => {
    it('returns true when all entries match the value', () => {
      const condition: TransitionCondition = {
        type: 'metadata_all_match',
        key: 'criteria',
        field: 'status',
        value: 'passed',
      }
      const entries = {
        criteria: [
          makeMetadataEntry({ id: 'c1', status: 'passed' }),
          makeMetadataEntry({ id: 'c2', status: 'passed' }),
        ],
      }
      expect(evaluateCondition(condition, null, entries)).toBe(true)
    })

    it('returns false when some entries do not match', () => {
      const condition: TransitionCondition = {
        type: 'metadata_all_match',
        key: 'criteria',
        field: 'status',
        value: 'passed',
      }
      const entries = {
        criteria: [
          makeMetadataEntry({ id: 'c1', status: 'passed' }),
          makeMetadataEntry({ id: 'c2', status: 'pending' }),
        ],
      }
      expect(evaluateCondition(condition, null, entries)).toBe(false)
    })

    it('returns true for empty entries (vacuous truth)', () => {
      const condition: TransitionCondition = {
        type: 'metadata_all_match',
        key: 'criteria',
        field: 'status',
        value: 'passed',
      }
      expect(evaluateCondition(condition, null, { criteria: [] })).toBe(true)
    })

    it('returns true when key does not exist (vacuous truth)', () => {
      const condition: TransitionCondition = {
        type: 'metadata_all_match',
        key: 'nonexistent',
        field: 'status',
        value: 'passed',
      }
      expect(evaluateCondition(condition, null, { criteria: [] })).toBe(true)
    })

    it('returns false when metadataEntries is undefined', () => {
      const condition: TransitionCondition = {
        type: 'metadata_all_match',
        key: 'criteria',
        field: 'status',
        value: 'passed',
      }
      expect(evaluateCondition(condition, null, undefined)).toBe(false)
    })
  })

  describe('metadata_all_in', () => {
    it('returns true when all entries have status in the list', () => {
      const condition: TransitionCondition = {
        type: 'metadata_all_in',
        key: 'criteria',
        field: 'status',
        values: ['completed', 'passed'],
      }
      const entries = {
        criteria: [
          makeMetadataEntry({ id: 'c1', status: 'completed' }),
          makeMetadataEntry({ id: 'c2', status: 'passed' }),
        ],
      }
      expect(evaluateCondition(condition, null, entries)).toBe(true)
    })

    it('returns false when some entries have status outside the list', () => {
      const condition: TransitionCondition = {
        type: 'metadata_all_in',
        key: 'criteria',
        field: 'status',
        values: ['completed', 'passed'],
      }
      const entries = {
        criteria: [
          makeMetadataEntry({ id: 'c1', status: 'completed' }),
          makeMetadataEntry({ id: 'c2', status: 'failed' }),
        ],
      }
      expect(evaluateCondition(condition, null, entries)).toBe(false)
    })

    it('returns true for empty entries (vacuous truth)', () => {
      const condition: TransitionCondition = {
        type: 'metadata_all_in',
        key: 'criteria',
        field: 'status',
        values: ['resolved', 'dismissed'],
      }
      expect(evaluateCondition(condition, null, { review_findings: [] })).toBe(true)
    })

    it('returns true when key does not exist (vacuous truth)', () => {
      const condition: TransitionCondition = {
        type: 'metadata_all_in',
        key: 'nonexistent',
        field: 'status',
        values: ['resolved'],
      }
      expect(evaluateCondition(condition, null, { criteria: [] })).toBe(true)
    })

    it('returns false when metadataEntries is undefined', () => {
      const condition: TransitionCondition = {
        type: 'metadata_all_in',
        key: 'criteria',
        field: 'status',
        values: ['passed'],
      }
      expect(evaluateCondition(condition, null, undefined)).toBe(false)
    })
  })

  describe('always', () => {
    it('always returns true', () => {
      const condition: TransitionCondition = { type: 'always' }
      expect(evaluateCondition(condition, null)).toBe(true)
    })

    it('returns true regardless of metadata state', () => {
      const condition: TransitionCondition = { type: 'always' }
      expect(evaluateCondition(condition, null, { criteria: [makeMetadataEntry({ status: 'pending' })] })).toBe(true)
    })
  })
})

// ============================================================================
// evaluateTransitions
// ============================================================================

describe('evaluateTransitions', () => {
  it('returns goto of the first matching transition', () => {
    const transitions: Transition[] = [
      { when: { type: 'metadata_all_match', key: 'criteria', field: 'status', value: 'passed' }, goto: TERMINAL_DONE },
      { when: { type: 'always' }, goto: 'build' },
    ]
    const entries = { criteria: [makeMetadataEntry({ id: 'c1', status: 'passed' })] }
    expect(evaluateTransitions(transitions, null, entries)).toBe(TERMINAL_DONE)
  })

  it('skips non-matching transitions and picks the first match', () => {
    const transitions: Transition[] = [
      { when: { type: 'metadata_all_match', key: 'criteria', field: 'status', value: 'passed' }, goto: TERMINAL_DONE },
      { when: { type: 'always' }, goto: 'fallback' },
    ]
    const entries = { criteria: [makeMetadataEntry({ id: 'c1', status: 'pending' })] }
    expect(evaluateTransitions(transitions, null, entries)).toBe('fallback')
  })

  it('returns TERMINAL_BLOCKED when no transitions match', () => {
    const transitions: Transition[] = [{ when: { type: 'step_result', result: 'success' }, goto: TERMINAL_DONE }]
    expect(evaluateTransitions(transitions, null)).toBe(TERMINAL_BLOCKED)
  })

  it('returns TERMINAL_BLOCKED for empty transitions array', () => {
    expect(evaluateTransitions([], null)).toBe(TERMINAL_BLOCKED)
  })

  it('uses stepOutcome for step_result conditions', () => {
    const transitions: Transition[] = [
      { when: { type: 'step_result', result: 'success' }, goto: 'verify' },
      { when: { type: 'step_result', result: 'failure' }, goto: 'retry' },
    ]
    expect(evaluateTransitions(transitions, { result: 'failure', output: {} })).toBe('retry')
  })
})

// ============================================================================
// resolveTemplate
// ============================================================================

describe('resolveTemplate', () => {
  it('replaces all template variables', () => {
    const ctx = makeTemplateContext()
    const template =
      'Dir: {{workdir}}, Reason: {{reason}}, Findings: {{verifierFindings}}, ' +
      'Prev: {{previousStepOutput}}, Count: {{criteriaCount}}, Pending: {{pendingCount}}, ' +
      'List: {{criteriaList}}, Files: {{modifiedFiles}}'

    const result = resolveTemplate(template, ctx)

    expect(result).toBe(
      'Dir: /tmp/project, Reason: 2 criteria remaining, Findings: Some findings, ' +
        'Prev: exit 0, Count: 3, Pending: 2, ' +
        'List: - c1 [PASSED]: do thing, Files: - src/index.ts',
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

  it('resolves stepOutput.* template variables', () => {
    const ctx = makeTemplateContext({
      stepOutput: { content: 'Test passed', stdout: 'output', stderr: 'error', exitCode: '0' },
    })
    const template =
      'Content: {{stepOutput.content}}, Stdout: {{stepOutput.stdout}}, Stderr: {{stepOutput.stderr}}, ExitCode: {{stepOutput.exitCode}}'
    expect(resolveTemplate(template, ctx)).toBe('Content: Test passed, Stdout: output, Stderr: error, ExitCode: 0')
  })

  it('resolves stepOutput.* with partial data', () => {
    const ctx = makeTemplateContext({ stepOutput: { content: 'Only content' } })
    const template = 'Content: {{stepOutput.content}}, Stdout: {{stepOutput.stdout}}'
    expect(resolveTemplate(template, ctx)).toBe('Content: Only content, Stdout: ')
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
    const entries: MetadataEntry[] = [
      { id: 'c1', description: 'Add tests', status: 'passed' },
      { id: 'c2', description: 'Fix bug', status: 'completed' },
      { id: 'c3', description: 'Update docs', status: 'failed' },
      { id: 'c4', description: 'Refactor', status: 'pending' },
    ]
    const result = formatCriteriaList(entries)
    expect(result).toBe(
      '- **c1** [PASSED]: Add tests\n' +
        '- **c2** [NEEDS VERIFICATION]: Fix bug\n' +
        '- **c3** [FAILED]: Update docs\n' +
        '- **c4** [NOT COMPLETED]: Refactor',
    )
  })

  it('formats a single criterion', () => {
    const entries: MetadataEntry[] = [{ id: 'only', description: 'One thing', status: 'pending' }]
    expect(formatCriteriaList(entries)).toBe('- **only** [NOT COMPLETED]: One thing')
  })
})

// ============================================================================
// formatModifiedFiles
// ============================================================================

describe('formatModifiedFiles', () => {
  it('returns (none) outside a git repo', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'openfox-test-'))
    try {
      expect(await formatModifiedFiles(tmp)).toBe('(none)')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns (none) when no files are modified', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'openfox-test-'))
    try {
      execSync('git init', { cwd: tmp, stdio: 'pipe' })
      execSync('git config user.email test@test.com', { cwd: tmp, stdio: 'pipe' })
      execSync('git config user.name test', { cwd: tmp, stdio: 'pipe' })
      writeFileSync(join(tmp, 'README.md'), '# hello')
      execSync('git add . && git commit -m init', { cwd: tmp, stdio: 'pipe' })
      expect(await formatModifiedFiles(tmp)).toBe('(none)')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('lists modified and untracked files', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'openfox-test-'))
    try {
      execSync('git init', { cwd: tmp, stdio: 'pipe' })
      execSync('git config user.email test@test.com', { cwd: tmp, stdio: 'pipe' })
      execSync('git config user.name test', { cwd: tmp, stdio: 'pipe' })
      writeFileSync(join(tmp, 'existing.ts'), 'original')
      execSync('git add . && git commit -m init', { cwd: tmp, stdio: 'pipe' })
      writeFileSync(join(tmp, 'existing.ts'), 'modified')
      writeFileSync(join(tmp, 'new.ts'), 'untracked')
      const result = await formatModifiedFiles(tmp)
      expect(result).toContain('existing.ts')
      expect(result).toContain('new.ts')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ============================================================================
// buildReason
// ============================================================================

describe('buildReason', () => {
  it('counts non-passed metadata entries as remaining', () => {
    const entries = {
      criteria: [
        makeMetadataEntry({ id: 'c1', status: 'passed' }),
        makeMetadataEntry({ id: 'c2', status: 'pending' }),
        makeMetadataEntry({ id: 'c3', status: 'failed' }),
      ],
    }
    expect(buildReason(entries)).toBe('2 criteria remaining')
  })

  it('returns 0 when all criteria are passed', () => {
    const entries = { criteria: [makeMetadataEntry({ id: 'c1', status: 'passed' })] }
    expect(buildReason(entries)).toBe('0 criteria remaining')
  })

  it('handles empty criteria', () => {
    expect(buildReason({ criteria: [] })).toBe('0 criteria remaining')
  })

  it('handles undefined metadata entries', () => {
    expect(buildReason(undefined)).toBe('0 criteria remaining')
  })
})

// ============================================================================
// Backwards Compatibility Tests
// ============================================================================

describe('Backwards Compatibility', () => {
  it('step_result with success/failure still works', () => {
    const successCondition: TransitionCondition = { type: 'step_result', result: 'success' }
    const failureCondition: TransitionCondition = { type: 'step_result', result: 'failure' }

    expect(evaluateCondition(successCondition, { result: 'success', output: {} })).toBe(true)
    expect(evaluateCondition(failureCondition, { result: 'failure', output: {} })).toBe(true)
  })

  it('verifierFindings and previousStepOutput still resolve', () => {
    const ctx = makeTemplateContext({
      stepOutput: { content: 'New content', stdout: 'new stdout' },
    })
    const template = 'Findings: {{verifierFindings}}, Prev: {{previousStepOutput}}'
    const result = resolveTemplate(template, ctx)
    expect(result).toBe('Findings: New content, Prev: new stdout')
  })

  it('sub-agent without result defaults to success', () => {
    const transitions: Transition[] = [{ when: { type: 'step_result', result: 'success' }, goto: 'next' }]
    expect(evaluateTransitions(transitions, { result: 'success', output: {} })).toBe('next')
  })
})

describe('Agent completed result', () => {
  it('agent steps produce result: completed', () => {
    const transitions: Transition[] = [{ when: { type: 'step_result', result: 'completed' }, goto: 'test' }]
    expect(evaluateTransitions(transitions, { result: 'completed', output: {} })).toBe('test')
  })
})

describe('Example workflow: build → test → fix', () => {
  it('routes correctly based on test result', () => {
    const buildTransitions: Transition[] = [{ when: { type: 'always' }, goto: 'test' }]
    const testTransitions: Transition[] = [
      { when: { type: 'step_result', result: 'passed' }, goto: '$done' },
      { when: { type: 'step_result', result: 'failed' }, goto: 'fix' },
      { when: { type: 'step_result', result: 'error' }, goto: '$blocked' },
    ]
    const fixTransitions: Transition[] = [{ when: { type: 'always' }, goto: 'test' }]

    const buildOutcome = { result: 'completed', output: {} }
    expect(evaluateTransitions(buildTransitions, buildOutcome)).toBe('test')

    const testFailedOutcome = { result: 'failed', output: { content: 'Test failures:\n- foo.test.ts' } }
    expect(evaluateTransitions(testTransitions, testFailedOutcome)).toBe('fix')

    const testPassedOutcome = { result: 'passed', output: { content: 'All tests passed' } }
    expect(evaluateTransitions(testTransitions, testPassedOutcome)).toBe('$done')

    const testErrorOutcome = { result: 'error', output: { content: 'Test suite crashed' } }
    expect(evaluateTransitions(testTransitions, testErrorOutcome)).toBe('$blocked')

    const fixOutcome = { result: 'completed', output: {} }
    expect(evaluateTransitions(fixTransitions, fixOutcome)).toBe('test')
  })

  it('supports stepOutput template variables in nudge prompt', () => {
    const nudgeTemplate = 'Fix the failures:\n\n{{stepOutput.content}}'
    const ctx: TemplateContext = makeTemplateContext({
      stepOutput: { content: 'Test failures:\n- foo.test.ts: expect(1).toBe(2)' },
    })
    const resolved = resolveTemplate(nudgeTemplate, ctx)
    expect(resolved).toBe('Fix the failures:\n\nTest failures:\n- foo.test.ts: expect(1).toBe(2)')
  })
})
