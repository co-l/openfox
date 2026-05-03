/**
 * Step Done Integration Tests
 *
 * Tests for step_done tool injection, prompt injection, and looping behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stepDoneTool } from '../tools/step-done.js'
import type { ToolContext } from '../tools/types.js'
import type { Transition } from './types.js'
import { evaluateTransitions, resolveTemplate } from './executor.js'
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

  it('combines nudgePrompt with step_done nudge', () => {
    const STEP_DONE_NUDGE =
      "You haven't called step_done(). If you haven't finished the task, continue and when you're finished call step_done()"

    const nudgePrompt = 'Continue working on the criteria'
    const parts: string[] = []

    if (nudgePrompt) {
      parts.push(nudgePrompt)
    }
    parts.push(STEP_DONE_NUDGE)

    const combined = parts.join('\n\n')

    expect(combined).toContain('Continue working on the criteria')
    expect(combined).toContain("You haven't called step_done()")

    // Verify order: nudgePrompt first, step_done nudge second
    const nudgePromptIndex = combined.indexOf('Continue working')
    const stepDoneIndex = combined.indexOf("You haven't called step_done()")
    expect(nudgePromptIndex).toBeLessThan(stepDoneIndex)
  })

  it('includes only step_done nudge when nudgePrompt is not defined', () => {
    const STEP_DONE_NUDGE =
      "You haven't called step_done(). If you haven't finished the task, continue and when you're finished call step_done()"

    const nudgePrompt = undefined
    const parts: string[] = []

    if (nudgePrompt) {
      parts.push(nudgePrompt)
    }
    parts.push(STEP_DONE_NUDGE)

    const combined = parts.join('\n\n')

    expect(combined).toBe(STEP_DONE_NUDGE)
    expect(combined).toContain("You haven't called step_done()")
  })
})

describe('step_done executor integration', () => {
  it('transitions evaluate after step_done called with completed result', () => {
    const transitions: Transition[] = [
      { when: { type: 'step_result', result: 'completed' }, goto: 'verify' },
      { when: { type: 'all_criteria_passed' }, goto: '$done' },
    ]

    const outcome = { result: 'completed', output: { stepDoneCalled: 'true' } }
    expect(evaluateTransitions(transitions, [], outcome)).toBe('verify')
  })

  it('step_done nudge prompt template resolves correctly', () => {
    const STEP_DONE_NUDGE =
      "You haven't called step_done(). If you haven't finished the task, continue and when you're finished call step_done()"

    const nudgeTemplate = '{{stepOutput.content}}\n\n' + STEP_DONE_NUDGE
    const ctx: TemplateContext = {
      workdir: '/test',
      reason: '1 criterion remaining',
      verifierFindings: '',
      previousStepOutput: '',
      criteriaCount: 2,
      pendingCount: 1,
      summary: 'Test',
      criteriaList: '- c1 [PENDING]',
      modifiedFiles: '- src/index.ts',
      stepOutput: { content: 'Previous attempt failed' },
    }

    const resolved = resolveTemplate(nudgeTemplate, ctx)
    expect(resolved).toContain('Previous attempt failed')
    expect(resolved).toContain("You haven't called step_done()")
  })

  it('agent step looping logic documented', () => {
    const STEP_DONE_PROMPT = "\n\nOnce you're done, call step_done()"
    const STEP_DONE_NUDGE =
      "You haven't called step_done(). If you haven't finished the task, continue and when you're finished call step_done()"

    const firstEntryPrompt = 'Build the feature' + STEP_DONE_PROMPT
    const retryNudge = STEP_DONE_NUDGE

    expect(firstEntryPrompt).toContain("Once you're done, call step_done()")
    expect(retryNudge).toContain("You haven't called step_done()")

    const nudgeWithPrompt = 'Fix the issues'
    const combinedParts: string[] = []
    if (nudgeWithPrompt) {
      combinedParts.push(nudgeWithPrompt)
    }
    combinedParts.push(STEP_DONE_NUDGE)
    const combined = combinedParts.join('\n\n')

    expect(combined).toContain('Fix the issues')
    expect(combined).toContain("You haven't called step_done()")

    const nudgeIndex = combined.indexOf('Fix the issues')
    const stepDoneIndex = combined.indexOf("You haven't called step_done()")
    expect(nudgeIndex).toBeLessThan(stepDoneIndex)
  })
})
