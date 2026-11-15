/**
 * Workflow Executor — Engine Iteration Counters
 *
 * The viewer shows the engine's own counters, so these tests pin the exact
 * contract: iterations consumed per invocation, the cumulative count across
 * invocations (resume), the engine cap, and the per-step iteration counts.
 * No value is derived from timestamps or reconstructed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkflowDefinition } from './types.js'
import type { OrchestratorOptions } from '../runner/types.js'

vi.mock('../events/index.js', () => ({
  getEventStore: () => ({
    append: vi.fn(),
    getLatestSeq: vi.fn(() => 0),
    getEvents: vi.fn(() => []),
    deleteEventsAfterSeq: vi.fn(),
  }),
  getCurrentContextWindowId: vi.fn(() => undefined),
}))

vi.mock('../chat/orchestrator.js', () => ({
  runAgentTurn: vi.fn(
    async (
      _opts: any,
      _metrics: any,
      _agentId: string,
      _append: any,
      extra: { onToolExecuted?: (tc: any, tr: any) => void } | undefined,
    ) => {
      // Simulate step_done so the agent step completes and the engine moves on.
      extra?.onToolExecuted?.({ name: 'step_done', arguments: {} }, { success: true, output: '' })
      return {
        returnValueResult: 'completed',
        returnValueContent: '',
      }
    },
  ),
  createMessageStartEvent: vi.fn(() => ({ type: 'message.start', data: {} })),
  TurnMetrics: class TurnMetrics {
    start = vi.fn()
    end = vi.fn()
    getMetrics = vi.fn(() => ({ durationMs: 0, tokenCount: 0 }))
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

vi.mock('../agents/model-overrides.js', () => ({
  resolveLLMClientForAgent: vi.fn(),
  buildAgentOverrideStatsIdentity: vi.fn(() => ({})),
  getAgentModelOverride: vi.fn(),
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
import { runAgentTurn } from '../chat/orchestrator.js'

type Counters = {
  iterations: number
  totalIterations: number
  maxIterations?: number
  stepIterations?: Record<string, number>
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
      updateWorkflowIterations: vi.fn(),
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

/**
 * The counters of the last updateWorkflowStep call. The counters are the
 * second-to-last argument; the last one is the workflow scope.
 */
function lastStepCounters(options: OrchestratorOptions): Counters | undefined {
  const sm = options.sessionManager as unknown as { updateWorkflowStep: ReturnType<typeof vi.fn> }
  const calls = sm.updateWorkflowStep.mock.calls
  const last = calls[calls.length - 1]
  if (!last) return undefined
  const counters = last[last.length - 2]
  return counters as Counters | undefined
}

function allStepCounters(options: OrchestratorOptions): Counters[] {
  const sm = options.sessionManager as unknown as { updateWorkflowStep: ReturnType<typeof vi.fn> }
  return sm.updateWorkflowStep.mock.calls.map((call) => call[call.length - 2] as Counters)
}

describe('workflow engine iteration counters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(runAgentTurn as unknown as ReturnType<typeof vi.fn>).mockImplementation(
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
  })

  it('reports the exact iteration count and the engine cap for a single-step run', async () => {
    const workflow: WorkflowDefinition = {
      metadata: { id: 'wf', name: 'WF', description: '', version: '1' },
      entryStep: 'build',
      settings: { maxIterations: 50 },
      steps: [
        {
          id: 'build',
          name: 'Builder',
          type: 'agent',
          phase: 'build',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }
    const options = createMockOptions()

    await executeWorkflow(workflow, options)

    const counters = lastStepCounters(options)
    expect(counters?.iterations).toBe(1)
    expect(counters?.totalIterations).toBe(1)
    expect(counters?.maxIterations).toBe(50)
    expect(counters?.stepIterations).toEqual({ build: 1 })
  })

  it('counts one iteration per step execution and accumulates per-step counts on a loop', async () => {
    // build -> verify -> build (loop) -> verify -> $done
    const workflow: WorkflowDefinition = {
      metadata: { id: 'wf', name: 'WF', description: '', version: '1' },
      entryStep: 'build',
      settings: { maxIterations: 50 },
      steps: [
        {
          id: 'build',
          name: 'Builder',
          type: 'agent',
          phase: 'build',
          transitions: [{ when: { type: 'always' }, goto: 'verify' }],
        },
        {
          id: 'verify',
          name: 'Verifier',
          type: 'agent',
          phase: 'verification',
          transitions: [{ when: { type: 'always' }, goto: 'build' }],
        },
      ],
    }
    const options = createMockOptions()

    // The loop never terminates on its own — cut it with the engine cap.
    await executeWorkflow(workflow, options)

    const counters = allStepCounters(options)
    // Every iteration of the loop reports a strictly increasing count.
    expect(counters.map((c) => c.iterations)).toEqual(counters.map((_, i) => i + 1))
    // The per-step map accumulates: two steps, each entered several times.
    const last = counters[counters.length - 1]!
    const buildCount = last.stepIterations?.['build'] ?? 0
    const verifyCount = last.stepIterations?.['verify'] ?? 0
    expect(buildCount + verifyCount).toBe(last.iterations)
    expect(buildCount).toBeGreaterThan(0)
    expect(verifyCount).toBeGreaterThan(0)
  })

  it('stops at the engine cap and reports the cap as the maximum', async () => {
    const workflow: WorkflowDefinition = {
      metadata: { id: 'wf', name: 'WF', description: '', version: '1' },
      entryStep: 'build',
      settings: { maxIterations: 3 },
      steps: [
        {
          id: 'build',
          name: 'Builder',
          type: 'agent',
          phase: 'build',
          transitions: [{ when: { type: 'always' }, goto: 'build' }],
        },
      ],
    }
    const options = createMockOptions()

    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction.type).toBe('BLOCKED')
    expect((result.finalAction as { reason: string }).reason).toContain('3')
    const counters = lastStepCounters(options)
    expect(counters?.iterations).toBe(3)
    expect(counters?.maxIterations).toBe(3)
  })

  it('restores the cumulative count and the per-step counts on resume', async () => {
    const workflow: WorkflowDefinition = {
      metadata: { id: 'wf', name: 'WF', description: '', version: '1' },
      entryStep: 'build',
      settings: { maxIterations: 50 },
      steps: [
        {
          id: 'build',
          name: 'Builder',
          type: 'agent',
          phase: 'build',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }
    const options = createMockOptions({
      resumeFromStep: 'build',
      sessionManager: {
        ...(createMockOptions().sessionManager as object),
        getActiveWorkflowExecution: vi.fn(() => ({
          id: 'exec-1',
          sessionId: 'test-session',
          workflowId: 'wf',
          workflowName: 'WF',
          status: 'running',
          currentStepId: 'build',
          stepOutput: {},
          params: {},
          totalIterations: 7,
          stepIterations: { build: 4 },
          createdAt: 1,
          updatedAt: 2,
        })),
      } as any,
    })

    await executeWorkflow(workflow, options)

    const counters = lastStepCounters(options)
    // The resumed invocation counts its own iterations from 1…
    expect(counters?.iterations).toBe(1)
    // …and the cumulative count continues from the persisted one.
    expect(counters?.totalIterations).toBe(8)
    // The per-step count continues from the persisted one too.
    expect(counters?.stepIterations).toEqual({ build: 5 })
  })

  it('starts a fresh execution with counters at zero', async () => {
    const workflow: WorkflowDefinition = {
      metadata: { id: 'wf', name: 'WF', description: '', version: '1' },
      entryStep: 'build',
      settings: { maxIterations: 50 },
      steps: [
        {
          id: 'build',
          name: 'Builder',
          type: 'agent',
          phase: 'build',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }
    const options = createMockOptions()

    await executeWorkflow(workflow, options)

    const sm = options.sessionManager as unknown as { startWorkflow: ReturnType<typeof vi.fn> }
    expect(sm.startWorkflow).toHaveBeenCalledWith(
      'test-session',
      expect.any(String),
      'wf',
      'WF',
      undefined,
      {},
      undefined,
      50,
      undefined,
    )
  })
})
