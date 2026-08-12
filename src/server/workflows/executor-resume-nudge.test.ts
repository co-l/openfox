/**
 * Workflow Executor – Resume Nudge Injection Tests
 *
 * When a workflow is resumed from an agent step (after abort + user interjection),
 * the first resumed turn intentionally skips prompt/nudge injection because the
 * user's message provides context. But if the agent doesn't call step_done, the
 * executor loops back — and on subsequent iterations the nudge MUST be injected.
 *
 * Bug: isResumingCurrentStep stayed true forever, suppressing the nudge on every
 * subsequent iteration. The agent looped silently without any reminder to call
 * step_done, appearing as a "relaunch without anything".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkflowDefinition } from './types.js'
import type { OrchestratorOptions } from '../runner/types.js'

// ============================================================================
// Hoisted shared spies — available in both vi.mock factories and test bodies
// ============================================================================

const { mockAppend } = vi.hoisted(() => ({ mockAppend: vi.fn() }))
const { mockRunAgentTurn } = vi.hoisted(() => ({ mockRunAgentTurn: vi.fn() }))

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('../events/index.js', () => ({
  getEventStore: () => ({
    append: mockAppend,
    getLatestSeq: vi.fn(() => 0),
    getEvents: vi.fn(() => []),
    deleteEventsAfterSeq: vi.fn(),
  }),
  getCurrentContextWindowId: vi.fn(() => undefined),
}))

vi.mock('../chat/orchestrator.js', () => ({
  runAgentTurn: mockRunAgentTurn,
  createMessageStartEvent: vi.fn(
    (messageId: string, role: string, content: string | undefined, options?: Record<string, unknown>) => ({
      type: 'message.start',
      data: { messageId, role, content, ...options },
    }),
  ),
  TurnMetrics: class TurnMetrics {
    start = vi.fn()
    end = vi.fn()
    addLLMCall = vi.fn()
    addToolTime = vi.fn()
    buildStats = vi.fn(() => ({ durationMs: 0, tokenCount: 0, generationTokens: 0, completionTokens: 0 }))
  },
}))

vi.mock('../sub-agents/manager.js', () => ({
  executeSubAgent: vi.fn(async () => ({ content: '', result: 'success' })),
}))

vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn(async () => []),
  findAgentById: vi.fn(() => undefined),
  resolveDefaultAgentId: vi.fn(() => 'planner'),
}))

vi.mock('../tools/index.js', () => ({
  getToolRegistryForAgent: vi.fn(() => ({ tools: [], definitions: [], execute: vi.fn() })),
}))

vi.mock('./shell.js', () => ({
  executeShellCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
}))

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../../shared/stats.js', () => ({
  computeSessionStats: vi.fn(() => ({ generationTokens: 0, avgGenerationSpeed: 0, responseCount: 0, llmCallCount: 0 })),
}))

vi.mock('../git/diff.js', () => ({
  formatGitDiffFiles: vi.fn(async () => '(none)'),
}))

import { executeWorkflow } from './executor.js'

// ============================================================================
// Helpers
// ============================================================================

function createWorkflow(overrides?: Partial<WorkflowDefinition>): WorkflowDefinition {
  return {
    metadata: { id: 'test', name: 'Test', description: '', version: '1' },
    entryStep: 'build',
    settings: { maxIterations: 10 },
    steps: [
      {
        id: 'build',
        name: 'Builder',
        type: 'agent',
        phase: 'build',
        agentId: 'builder',
        prompt: 'Implement the feature according to the plan.',
        nudgePrompt: "Keep going, you're almost there.",
        transitions: [{ when: { type: 'always' }, goto: '$done' }],
      },
    ],
    ...overrides,
  }
}

function createMockOptions(extra?: Partial<OrchestratorOptions>): OrchestratorOptions {
  return {
    scope: 'auto',
    sessionManager: {
      requireSession: vi.fn(() => ({
        workdir: '/tmp/test',
        messages: [],
        metadataEntries: {},
      })),
      setMode: vi.fn(),
      setPhase: vi.fn(),
      getEffectiveWorkdir: vi.fn().mockReturnValue('/tmp/test'),
      getProjectWorkdir: vi.fn().mockReturnValue('/tmp/test'),
      addMessage: vi.fn(),
      startWorkflow: vi.fn(),
      updateWorkflowStep: vi.fn(),
      completeWorkflow: vi.fn(),
      blockWorkflow: vi.fn(),
      waitAtStep: vi.fn(),
      resumeWorkflow: vi.fn(),
      getActiveWorkflowExecution: vi.fn(() => null),
      cancelWorkflow: vi.fn(),
    } as any,
    sessionId: 'test-session',
    llmClient: { getModel: () => 'test-model' } as any,
    ...extra,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('workflow resume nudge injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('injects step_done nudge on second iteration after resume when step_done not called', async () => {
    let callCount = 0
    mockRunAgentTurn.mockImplementation(
      async (
        _opts: any,
        _metrics: any,
        _agentId: string,
        _append: any,
        extra: { onToolExecuted?: (tc: any, tr: any) => void } | undefined,
      ) => {
        callCount++
        if (callCount === 1) {
          // First resumed turn: agent doesn't call step_done
          return { returnValueResult: 'completed', returnValueContent: '' }
        }
        // Second turn: agent finally calls step_done
        extra?.onToolExecuted?.({ name: 'step_done', arguments: {} }, { success: true, output: '' })
        return { returnValueResult: 'completed', returnValueContent: '' }
      },
    )

    const workflow = createWorkflow()
    const options = createMockOptions({ resumeFromStep: 'build', initialStepOutput: {} })

    await executeWorkflow(workflow, options)

    // The executor should have called runAgentTurn twice:
    //   1st: resumed turn (no step_done → loops back)
    //   2nd: nudged turn (step_done called → completes)
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(2)

    // A nudge message containing the step_done reminder should have been
    // appended to the event store between the two agent turns.
    const nudgeEvents = mockAppend.mock.calls.filter(
      (call: any[]) =>
        call[1]?.type === 'message.start' &&
        call[1]?.data?.isSystemGenerated &&
        typeof call[1]?.data?.content === 'string' &&
        (call[1]?.data?.content as string).includes("You haven't called step_done()"),
    )

    expect(nudgeEvents.length).toBeGreaterThan(0)
  })

  it('does not inject prompt or nudge on the first resumed turn', async () => {
    // Agent calls step_done on the very first resumed turn
    mockRunAgentTurn.mockImplementation(
      async (
        _opts: any,
        _metrics: any,
        _agentId: string,
        _append: any,
        extra: { onToolExecuted?: (tc: any, tr: any) => void } | undefined,
      ) => {
        extra?.onToolExecuted?.({ name: 'step_done', arguments: {} }, { success: true, output: '' })
        return { returnValueResult: 'completed', returnValueContent: '' }
      },
    )

    const workflow = createWorkflow()
    const options = createMockOptions({ resumeFromStep: 'build', initialStepOutput: {} })

    // Capture the number of append calls BEFORE executeWorkflow
    const beforeCount = mockAppend.mock.calls.length

    await executeWorkflow(workflow, options)

    // Get all message.start events that were appended during execution
    const allEvents = mockAppend.mock.calls.slice(beforeCount).map((call: any[]) => call[1])
    const messageStarts = allEvents.filter((e: any) => e.type === 'message.start')

    // None of the message.start events should contain the prompt or nudge
    // (the workflow prompt, the nudge, or the step_done reminder)
    const workflowMessages = messageStarts.filter(
      (e: any) =>
        e.data?.isSystemGenerated && e.data?.metadata?.type === 'workflow' && typeof e.data?.content === 'string',
    )

    // The only system-generated workflow messages should be the workflow-started marker,
    // NOT the agent prompt or step_done nudge
    const promptOrNudge = workflowMessages.filter(
      (e: any) =>
        (e.data.content as string).includes('Implement the feature') ||
        (e.data.content as string).includes("You haven't called step_done()") ||
        (e.data.content as string).includes("Once you're done, call step_done()"),
    )

    expect(promptOrNudge).toHaveLength(0)
  })

  it('injects nudge on every subsequent iteration, not just the second', async () => {
    let callCount = 0
    mockRunAgentTurn.mockImplementation(
      async (
        _opts: any,
        _metrics: any,
        _agentId: string,
        _append: any,
        extra: { onToolExecuted?: (tc: any, tr: any) => void } | undefined,
      ) => {
        callCount++
        // Don't call step_done on calls 1-3, call it on the 4th
        if (callCount < 4) {
          return { returnValueResult: 'completed', returnValueContent: '' }
        }
        extra?.onToolExecuted?.({ name: 'step_done', arguments: {} }, { success: true, output: '' })
        return { returnValueResult: 'completed', returnValueContent: '' }
      },
    )

    const workflow = createWorkflow({ settings: { maxIterations: 20 } })
    const options = createMockOptions({ resumeFromStep: 'build', initialStepOutput: {} })

    await executeWorkflow(workflow, options)

    // runAgentTurn should have been called 4 times
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(4)

    // Count nudge events — there should be 3 (one before each of calls 2, 3, 4)
    const nudgeEvents = mockAppend.mock.calls.filter(
      (call: any[]) =>
        call[1]?.type === 'message.start' &&
        call[1]?.data?.isSystemGenerated &&
        typeof call[1]?.data?.content === 'string' &&
        (call[1]?.data?.content as string).includes("You haven't called step_done()"),
    )

    expect(nudgeEvents.length).toBe(3)
  })
})
