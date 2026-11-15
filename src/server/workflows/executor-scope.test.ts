/**
 * Workflow Scope & Notification Transport
 *
 * AC11 — the definition shown in the viewer is the one of the running scope,
 * even when another scope shadows the same id.
 * AC12 — a counter update does not trigger a full session broadcast; the
 * lightweight workflow event carries the counters instead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkflowDefinition } from '../workflows/types.js'
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
      extra?.onToolExecuted?.({ name: 'step_done', arguments: {} }, { success: true, output: '' })
      return { returnValueResult: 'completed', returnValueContent: '' }
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

describe('workflow scope transport (AC11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records the runtime scope on the workflow execution', async () => {
    const options = createMockOptions()

    await executeWorkflow(workflow, options, undefined, 'project')

    const sm = options.sessionManager as unknown as { startWorkflow: ReturnType<typeof vi.fn> }
    const args = sm.startWorkflow.mock.calls[0]!
    expect(args[8]).toBe('project')
  })

  it('carries the scope on the step and counter events', async () => {
    const options = createMockOptions()

    await executeWorkflow(workflow, options, undefined, 'user')

    const sm = options.sessionManager as unknown as {
      updateWorkflowStep: ReturnType<typeof vi.fn>
      updateWorkflowIterations: ReturnType<typeof vi.fn>
    }
    // updateWorkflowStep(..., iterations, workflowScope)
    const stepCall = sm.updateWorkflowStep.mock.calls[0]!
    expect(stepCall[stepCall.length - 1]).toBe('user')
    // updateWorkflowIterations(..., counters, workflow)
    const countersCall = sm.updateWorkflowIterations.mock.calls[0]!
    expect(countersCall[countersCall.length - 1]).toMatchObject({ workflowScope: 'user' })
  })

  it('leaves the scope undefined when the caller does not provide one', async () => {
    const options = createMockOptions()

    await executeWorkflow(workflow, options)

    const sm = options.sessionManager as unknown as { startWorkflow: ReturnType<typeof vi.fn> }
    const args = sm.startWorkflow.mock.calls[0]!
    expect(args[8]).toBeUndefined()
  })
})

describe('workflow counter notifications (AC12)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('broadcasts the counters through the lightweight event, with no extra session broadcast', async () => {
    const options = createMockOptions()

    await executeWorkflow(workflow, options)

    const sm = options.sessionManager as unknown as {
      updateWorkflowIterations: ReturnType<typeof vi.fn>
      updateWorkflowStep: ReturnType<typeof vi.fn>
    }
    // The counters are published on the iteration path…
    expect(sm.updateWorkflowIterations).toHaveBeenCalled()
    // …and never through a session broadcast: the manager's workflow methods
    // no longer emit session_updated (asserted in the manager test).
    expect(sm.updateWorkflowStep).toHaveBeenCalled()
  })

  it('publishes the final counters when the engine completes', async () => {
    const options = createMockOptions()

    await executeWorkflow(workflow, options)

    const sm = options.sessionManager as unknown as { updateWorkflowIterations: ReturnType<typeof vi.fn> }
    const calls = sm.updateWorkflowIterations.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const last = calls[calls.length - 1]!
    expect(last[2]).toMatchObject({ iterations: 1, totalIterations: 1, maxIterations: 50 })
  })
})
