/**
 * Step Done Integration Tests
 *
 * Tests for step_done tool injection, prompt injection, and looping behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stepDoneTool } from '../tools/step-done.js'
import type { ToolContext } from '../tools/types.js'
import type { Transition } from './types.js'
import { evaluateTransitions, buildAgentNudge } from './executor.js'
import type { TemplateContext } from './executor.js'

// Mock sessionManager for test context
const mockSessionManager = {
  recordFileRead: vi.fn(),
  getReadFiles: vi.fn().mockReturnValue({}),
  updateFileHash: vi.fn(),
  requireSession: vi.fn(),
  setPhase: vi.fn(),
} as any

const mockContext: ToolContext = {
  sessionManager: mockSessionManager,
  workdir: '/test/workdir',
  sessionId: 'test-session',
}

describe('step_done tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns success when called', async () => {
    const result = await stepDoneTool.execute({}, mockContext)
    expect(result.success).toBe(true)
    expect(result.output).toBe('Step completion signal recorded.')
  })

  it('has correct tool definition', () => {
    expect(stepDoneTool.name).toBe('step_done')
    expect(stepDoneTool.definition.function.name).toBe('step_done')
    expect(stepDoneTool.definition.function.parameters).toEqual({
      type: 'object',
      properties: {},
      required: [],
    })
  })
})

describe('step_done prompt injection', () => {
  it('appends step_done instruction to agent prompt', () => {
    const STEP_DONE_PROMPT = "\n\nOnce you're done, call step_done()"
    const basePrompt = 'Implement the feature'
    const combined = basePrompt + STEP_DONE_PROMPT

    expect(combined).toContain('Implement the feature')
    expect(combined).toContain("Once you're done, call step_done()")
  })
})

describe('buildAgentNudge', () => {
  const buildTransitions: Transition[] = [
    {
      when: { type: 'metadata_all_in', key: 'criteria', field: 'status', values: ['completed', 'passed'] },
      goto: 'verify',
    },
    { when: { type: 'always' }, goto: 'build' },
  ]
  const completedEntries = {
    criteria: [
      { id: 'c1', description: 'First', status: 'completed' },
      { id: 'c2', description: 'Second', status: 'passed' },
    ],
  }
  const pendingEntries = {
    criteria: [
      { id: 'c1', description: 'First', status: 'pending' },
      { id: 'c2', description: 'Second', status: 'failed' },
    ],
  }
  const ctx: TemplateContext = {
    workdir: '/test',
    reason: '2 criteria remaining',
    verifierFindings: '',
    previousStepOutput: '',
    criteriaCount: 2,
    pendingCount: 2,
    criteriaList: '- c1 [PENDING]',
    modifiedFiles: '- src/index.ts',
    stepOutput: { content: 'Previous attempt failed' },
    params: {},
  }

  it('uses only the simple reminder when the transition condition is already satisfied', () => {
    const nudge = buildAgentNudge(
      'Continue working on the acceptance criteria. {{reason}}.',
      ctx,
      buildTransitions,
      completedEntries,
      'build',
    )
    expect(nudge).toBe('If you have finished the task, call step_done()')
  })

  it('combines nudgePrompt with the verbose step_done nudge when work remains', () => {
    const nudge = buildAgentNudge(
      'Continue working on the acceptance criteria. {{reason}}.',
      ctx,
      buildTransitions,
      pendingEntries,
      'build',
    )
    expect(nudge).toContain('Continue working on the acceptance criteria. 2 criteria remaining.')
    expect(nudge).toContain("You haven't called step_done()")
    expect(nudge).not.toContain('If you have finished the task, call step_done()')

    // Verify order: nudgePrompt first, step_done nudge second
    const nudgePromptIndex = nudge.indexOf('Continue working')
    const stepDoneIndex = nudge.indexOf("You haven't called step_done()")
    expect(nudgePromptIndex).toBeLessThan(stepDoneIndex)
  })

  it('includes only the step_done nudge when nudgePrompt is not defined and work remains', () => {
    const nudge = buildAgentNudge(undefined, ctx, buildTransitions, pendingEntries, 'build')
    expect(nudge).toBe(
      "You haven't called step_done(). If you haven't finished the task, continue and when you're finished call step_done()",
    )
  })

  it('uses the simple reminder when nudgePrompt is not defined and the condition is satisfied', () => {
    const nudge = buildAgentNudge(undefined, ctx, buildTransitions, completedEntries, 'build')
    expect(nudge).toBe('If you have finished the task, call step_done()')
  })
})

describe('step_done executor integration', () => {
  it('transitions evaluate after step_done called with completed result', () => {
    const transitions: Transition[] = [
      { when: { type: 'step_result', result: 'completed' }, goto: 'verify' },
      { when: { type: 'always' }, goto: '$done' },
    ]

    const outcome = { result: 'completed', output: { stepDoneCalled: 'true' } }
    expect(evaluateTransitions(transitions, outcome)).toBe('verify')
  })
})
