/**
 * Workflow Executor – Sub-Group Slice Tests
 *
 * Verifies sub-group escape semantics (§7): when running a slice, a transition
 * tagged with the running sub-group may leave the active set and pull its target
 * step into the run (e.g. verify -> build -> verify loops), while untagged
 * transitions leaving the slice still clamp to $done.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkflowDefinition } from './types.js'
import type { OrchestratorOptions } from '../runner/types.js'
import type { MetadataEntry } from '../../shared/types.js'

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
import { executeSubAgent } from '../sub-agents/manager.js'
import { findAgentById } from '../agents/registry.js'

// ============================================================================
// Fixture: build & verify loop split across sub-groups (mirrors the default
// "Build & Verify" workflow's slice wiring).
// ============================================================================

function makeWorkflow(): WorkflowDefinition {
  return {
    metadata: { id: 'subgroup', name: 'Subgroup', description: '', version: '1' },
    entryStep: 'work_location',
    settings: { maxIterations: 15 },
    steps: [
      {
        id: 'work_location',
        name: 'Where to work',
        type: 'user',
        phase: 'build',
        subGroup: 'build',
        transitions: [
          { when: { type: 'step_result', result: 'current' }, goto: 'build' },
          { when: { type: 'step_result', result: 'new' }, goto: 'setup_workspace' },
        ],
      },
      {
        id: 'setup_workspace',
        name: 'Setting up workspace',
        type: 'agent',
        phase: 'build',
        agentId: 'builder',
        subGroup: 'build',
        transitions: [{ when: { type: 'always' }, goto: 'build' }],
      },
      {
        id: 'build',
        name: 'Implement',
        type: 'agent',
        phase: 'build',
        agentId: 'builder',
        subGroup: 'build',
        transitions: [
          {
            when: { type: 'metadata_all_in', key: 'criteria', field: 'status', values: ['completed', 'passed'] },
            goto: 'verify',
          },
          { when: { type: 'always' }, goto: 'build' },
        ],
      },
      {
        id: 'verify',
        name: 'Verifier',
        type: 'sub_agent',
        phase: 'verification',
        subAgentType: 'verifier',
        subGroup: 'verify',
        transitions: [
          {
            when: { type: 'metadata_all_match', key: 'criteria', field: 'status', value: 'passed' },
            goto: 'code_review',
          },
          { when: { type: 'always' }, goto: 'build', subGroup: 'verify' },
        ],
      },
      {
        id: 'code_review',
        name: 'Code Review',
        type: 'sub_agent',
        phase: 'verification',
        subAgentType: 'code_reviewer',
        subGroup: 'code review',
        transitions: [{ when: { type: 'always' }, goto: '$done' }],
      },
    ],
  }
}

function makeHarness(criteria: MetadataEntry[]) {
  const setMode = vi.fn()
  const setPhase = vi.fn()
  const mockSessionManager: any = {
    requireSession: vi.fn(() => ({
      workdir: '/tmp/test',
      messages: [],
      metadataEntries: { criteria },
    })),
    setMode,
    setPhase,
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
  }
  const options: OrchestratorOptions = {
    sessionManager: mockSessionManager,
    sessionId: 'test-session',
    llmClient: { getModel: () => 'test-model' } as any,
    scope: 'auto',
  }
  return { mockSessionManager, options }
}

describe('executeWorkflow sub-group slices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(runAgentTurn).mockImplementation(
      async (_opts: any, _metrics: any, _agentId: string, _append: any, extra: any) => {
        extra?.onToolExecuted?.({ name: 'step_done', arguments: {} }, { success: true, output: '' })
        return { returnValueResult: 'completed', returnValueContent: '' }
      },
    )
    vi.mocked(executeSubAgent).mockImplementation(async () => ({ content: '', result: 'success' }))
    vi.mocked(findAgentById).mockImplementation(() => ({ id: 'stub-agent', name: 'Stub Agent' }) as any)
  })

  it('verify slice escapes into the builder on failure and stops on all-passed', async () => {
    const criteria: MetadataEntry[] = [{ id: 'c1', description: 'Test', status: 'pending' }]
    const { mockSessionManager, options } = makeHarness(criteria)

    // Builder marks the criterion completed; verifier fails it on the first pass,
    // then passes it on the second pass (after the builder has reworked it).
    vi.mocked(runAgentTurn).mockImplementation(
      async (_opts: any, _metrics: any, _agentId: string, _append: any, extra: any) => {
        criteria[0]!.status = 'completed'
        extra?.onToolExecuted?.({ name: 'step_done', arguments: {} }, { success: true, output: '' })
        return { returnValueResult: 'completed', returnValueContent: '' }
      },
    )
    let verifyCalls = 0
    vi.mocked(executeSubAgent).mockImplementation(async () => {
      verifyCalls++
      criteria[0]!.status = verifyCalls === 1 ? 'failed' : 'passed'
      return { content: '', result: verifyCalls === 1 ? 'failed' : 'passed' }
    })

    const result = await executeWorkflow(makeWorkflow(), options, 'verify')

    // Failure -> builder -> verifier -> all-passed -> stop
    expect(result.finalAction).toHaveProperty('type', 'DONE')
    expect(verifyCalls).toBe(2)
    expect(vi.mocked(runAgentTurn)).toHaveBeenCalledTimes(1)
    expect(mockSessionManager.completeWorkflow).toHaveBeenCalled()
    // The slice name is persisted on the workflow execution
    const startArgs = mockSessionManager.startWorkflow.mock.calls[0]!
    expect(startArgs[startArgs.length - 1]).toBe('verify')
  })

  it('verify slice without a tagged escape transition clamps to $done (untagged regression)', async () => {
    const criteria: MetadataEntry[] = [{ id: 'c1', description: 'Test', status: 'pending' }]
    const { options } = makeHarness(criteria)

    const workflow = makeWorkflow()
    // Remove the sub-group tag from verify -> build: the edge must NOT escape.
    const verifyStep = workflow.steps.find((s) => s.id === 'verify')!
    verifyStep.transitions = [
      {
        when: { type: 'metadata_all_match', key: 'criteria', field: 'status', value: 'passed' },
        goto: 'code_review',
      },
      { when: { type: 'always' }, goto: 'build' },
    ]
    vi.mocked(executeSubAgent).mockImplementation(async () => {
      criteria[0]!.status = 'failed'
      return { content: '', result: 'failed' }
    })

    const result = await executeWorkflow(workflow, options, 'verify')

    expect(result.finalAction).toHaveProperty('type', 'DONE')
    expect(vi.mocked(runAgentTurn)).not.toHaveBeenCalled()
  })

  it('build slice starts at the workspace-choice step (request 2)', async () => {
    const criteria: MetadataEntry[] = [{ id: 'c1', description: 'Test', status: 'pending' }]
    const { mockSessionManager, options } = makeHarness(criteria)

    const result = await executeWorkflow(makeWorkflow(), options, 'build')

    // First step of the "build" slice is the user workspace-choice step
    expect(result.finalAction).toHaveProperty('type', 'WAITING')
    expect(result.finalAction).toHaveProperty('stepId', 'work_location')
    expect(mockSessionManager.waitAtStep).toHaveBeenCalled()
    // The slice name is persisted on the workflow execution
    const startArgs = mockSessionManager.startWorkflow.mock.calls[0]!
    expect(startArgs[startArgs.length - 1]).toBe('build')
  })

  it('build slice stops after implementing without running the verifier', async () => {
    const criteria: MetadataEntry[] = [{ id: 'c1', description: 'Test', status: 'pending' }]
    const { options } = makeHarness(criteria)

    vi.mocked(runAgentTurn).mockImplementation(
      async (_opts: any, _metrics: any, _agentId: string, _append: any, extra: any) => {
        criteria[0]!.status = 'completed'
        extra?.onToolExecuted?.({ name: 'step_done', arguments: {} }, { success: true, output: '' })
        return { returnValueResult: 'completed', returnValueContent: '' }
      },
    )
    const subAgentTypes: string[] = []
    vi.mocked(executeSubAgent).mockImplementation(async (args: any) => {
      subAgentTypes.push(args.subAgentType)
      return { content: '', result: 'success' }
    })

    // Skip past the workspace-choice user step, then implement and finish.
    // subGroup is forwarded positionally, as runOrchestrator does on resume.
    const result = await executeWorkflow(
      makeWorkflow(),
      {
        ...options,
        resumeFromStep: 'work_location',
        userChoice: 'current',
      },
      'build',
    )

    expect(result.finalAction).toHaveProperty('type', 'DONE')
    // The "build" slice must NOT escalate into verification — that's the "verify" slice's job
    expect(subAgentTypes).toEqual([])
  })

  it('full run ignores transition sub-group tags and still reaches code review', async () => {
    const criteria: MetadataEntry[] = [{ id: 'c1', description: 'Test', status: 'pending' }]
    const { options } = makeHarness(criteria)

    vi.mocked(runAgentTurn).mockImplementation(
      async (_opts: any, _metrics: any, _agentId: string, _append: any, extra: any) => {
        criteria[0]!.status = 'completed'
        extra?.onToolExecuted?.({ name: 'step_done', arguments: {} }, { success: true, output: '' })
        return { returnValueResult: 'completed', returnValueContent: '' }
      },
    )
    const subAgentTypes: string[] = []
    vi.mocked(executeSubAgent).mockImplementation(async (args: any) => {
      subAgentTypes.push(args.subAgentType)
      criteria[0]!.status = 'passed'
      return { content: '', result: 'passed' }
    })

    // Skip past the user step via resume + choice, then build -> verify -> code review -> done
    const resumed = await executeWorkflow(makeWorkflow(), {
      ...options,
      resumeFromStep: 'work_location',
      userChoice: 'current',
    })

    expect(resumed.finalAction).toHaveProperty('type', 'DONE')
    expect(subAgentTypes).toEqual(['verifier', 'code_reviewer'])
  })
})
