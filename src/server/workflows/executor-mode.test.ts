/**
 * Workflow Executor – Mode Change Tests
 *
 * Verifies that executeWorkflow calls sessionManager.setMode()
 * when executing agent steps, so the session mode reflects the
 * current workflow step's agentId.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkflowDefinition } from './types.js'
import type { OrchestratorOptions } from '../runner/types.js'

// Mock event store
vi.mock('../events/index.js', () => ({
  getEventStore: () => ({
    append: vi.fn(),
  }),
  getCurrentContextWindowId: vi.fn(() => undefined),
}))

// Mock chat orchestrator
vi.mock('../chat/orchestrator.js', () => ({
  runAgentTurn: vi.fn(
    async (
      _opts: any,
      _metrics: any,
      _agentId: string,
      _append: any,
      extra: { onToolExecuted?: (tc: any, tr: any) => void } | undefined,
    ) => {
      // Simulate step_done being called so the step completes
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

// Mock sub-agents
vi.mock('../sub-agents/manager.js', () => ({
  executeSubAgent: vi.fn(async () => ({ content: '', result: 'success' })),
}))

// Mock agents registry
vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn(async () => []),
  findAgentById: vi.fn(() => undefined),
  resolveDefaultAgentId: vi.fn(() => 'planner'),
}))

// Mock tools
vi.mock('../tools/index.js', () => ({
  getToolRegistryForAgent: vi.fn(() => ({ tools: [], definitions: [], execute: vi.fn() })),
}))

// Mock shell
vi.mock('./shell.js', () => ({
  executeShellCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
}))

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Mock stats
vi.mock('../../shared/stats.js', () => ({
  computeSessionStats: vi.fn(() => ({ generationTokens: 0, avgGenerationSpeed: 0, responseCount: 0, llmCallCount: 0 })),
}))

// Mock git diff
vi.mock('../git/diff.js', () => ({
  formatGitDiffFiles: vi.fn(async () => '(none)'),
}))

import { executeWorkflow } from './executor.js'

describe('executeWorkflow mode changes', () => {
  let setMode: ReturnType<typeof vi.fn>
  let setPhase: ReturnType<typeof vi.fn>
  let mockSessionManager: any
  let options: OrchestratorOptions
  let workflow: WorkflowDefinition

  beforeEach(() => {
    vi.clearAllMocks()

    setMode = vi.fn()
    setPhase = vi.fn()

    mockSessionManager = {
      requireSession: vi.fn(() => ({
        workdir: '/tmp/test',
        messages: [],
        metadataEntries: {},
      })),
      setMode,
      setPhase,
      getEffectiveWorkdir: vi.fn().mockReturnValue('/tmp/test'),
      addMessage: vi.fn(),
      startWorkflow: vi.fn(),
      updateWorkflowStep: vi.fn(),
      completeWorkflow: vi.fn(),
      blockWorkflow: vi.fn(),
      waitAtStep: vi.fn((sessionId: string) => {
        ;(setPhase as any)(sessionId, 'waiting')
      }),
      resumeWorkflow: vi.fn(),
      getActiveWorkflowExecution: vi.fn(() => null),
      cancelWorkflow: vi.fn(),
      assertExecutionGitContext: vi.fn(async () => ({
        ok: true as const,
        workdir: '/tmp/test',
        expectedBranch: null,
        actualBranch: null,
      })),
    }

    options = {
      sessionManager: mockSessionManager,
      sessionId: 'test-session',
      llmClient: { getModel: () => 'test-model' } as any,
    }

    workflow = {
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
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }
  })

  it('calls setMode with the agent step agentId', async () => {
    await executeWorkflow(workflow, options)

    expect(setMode).toHaveBeenCalledWith('test-session', 'builder')
  })

  it('calls setMode before running the agent turn', async () => {
    await executeWorkflow(workflow, options)

    // setMode should be called before setPhase or at least alongside it
    expect(setMode).toHaveBeenCalled()
    expect(setPhase).toHaveBeenCalled()
  })

  it('does not call setMode for sub_agent steps', async () => {
    const subAgentWorkflow: WorkflowDefinition = {
      metadata: { id: 'test', name: 'Test', description: '', version: '1' },
      entryStep: 'verify',
      settings: { maxIterations: 10 },
      steps: [
        {
          id: 'verify',
          name: 'Verifier',
          type: 'sub_agent',
          phase: 'verification',
          subAgentType: 'verifier',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }

    await executeWorkflow(subAgentWorkflow, options)

    expect(setMode).not.toHaveBeenCalled()
  })

  it('does not call setMode for shell steps', async () => {
    const shellWorkflow: WorkflowDefinition = {
      metadata: { id: 'test', name: 'Test', description: '', version: '1' },
      entryStep: 'lint',
      settings: { maxIterations: 10 },
      steps: [
        {
          id: 'lint',
          name: 'Lint',
          type: 'shell',
          phase: 'verification',
          command: 'npm run lint',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }

    await executeWorkflow(shellWorkflow, options)

    expect(setMode).not.toHaveBeenCalled()
  })

  it('defaults agentId to "planner" when not specified', async () => {
    const noAgentIdWorkflow: WorkflowDefinition = {
      metadata: { id: 'test', name: 'Test', description: '', version: '1' },
      entryStep: 'plan',
      settings: { maxIterations: 10 },
      steps: [
        {
          id: 'plan',
          name: 'Plan',
          type: 'agent',
          phase: 'build',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }

    await executeWorkflow(noAgentIdWorkflow, options)

    expect(setMode).toHaveBeenCalledWith('test-session', 'planner')
  })

  it('does not reset mode on $done terminal state', async () => {
    await executeWorkflow(workflow, options)

    // setMode should only have been called for the agent step, not on $done
    expect(setMode).toHaveBeenCalledTimes(1)
    expect(setMode).toHaveBeenCalledWith('test-session', 'builder')
  })

  it('does not call setMode for user steps', async () => {
    const userStepWorkflow: WorkflowDefinition = {
      metadata: { id: 'test', name: 'Test', description: '', version: '1' },
      entryStep: 'pause',
      settings: { maxIterations: 10 },
      steps: [
        {
          id: 'pause',
          name: 'Pause',
          type: 'user',
          phase: 'verification',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }

    const result = await executeWorkflow(userStepWorkflow, options)

    expect(setMode).not.toHaveBeenCalled()
    expect(result.finalAction).toHaveProperty('type', 'WAITING')
    expect(result.finalAction).toHaveProperty('workflowId', 'test')
    expect(result.finalAction).toHaveProperty('stepId', 'pause')
  })

  it('user step sets phase to waiting', async () => {
    const userStepWorkflow: WorkflowDefinition = {
      metadata: { id: 'test', name: 'Test', description: '', version: '1' },
      entryStep: 'pause',
      settings: { maxIterations: 10 },
      steps: [
        {
          id: 'pause',
          name: 'Pause',
          type: 'user',
          phase: 'verification',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }

    await executeWorkflow(userStepWorkflow, options)

    expect(setPhase).toHaveBeenCalledWith('test-session', 'waiting')
  })

  it('user step returns WAITING with workflow and step info', async () => {
    const userStepWorkflow: WorkflowDefinition = {
      metadata: { id: 'test', name: 'Test', description: '', version: '1' },
      entryStep: 'pause',
      settings: { maxIterations: 10 },
      steps: [
        {
          id: 'pause',
          name: 'Pause',
          type: 'user',
          phase: 'verification',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }

    const result = await executeWorkflow(userStepWorkflow, options)

    expect(result.finalAction).toHaveProperty('type', 'WAITING')
    expect(result.finalAction).toHaveProperty('workflowId', 'test')
    expect(result.finalAction).toHaveProperty('stepId', 'pause')
  })

  it('resume from user step continues to next step', async () => {
    const workflow: WorkflowDefinition = {
      metadata: { id: 'test', name: 'Test', description: '', version: '1' },
      entryStep: 'pause',
      settings: { maxIterations: 10 },
      steps: [
        {
          id: 'pause',
          name: 'Pause',
          type: 'user',
          phase: 'verification',
          transitions: [{ when: { type: 'always' }, goto: 'done_step' }],
        },
        {
          id: 'done_step',
          name: 'Done',
          type: 'agent',
          phase: 'build',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }

    const result = await executeWorkflow(workflow, {
      ...options,
      resumeFromStep: 'pause',
      initialStepOutput: { previous: 'output' },
    })

    // Should reach $done (not WAITING) because we resume from the user step
    expect(result.finalAction).toHaveProperty('type', 'DONE')
  })

  it('resume from user step does not set phase to waiting', async () => {
    const workflow: WorkflowDefinition = {
      metadata: { id: 'test', name: 'Test', description: '', version: '1' },
      entryStep: 'pause',
      settings: { maxIterations: 10 },
      steps: [
        {
          id: 'pause',
          name: 'Pause',
          type: 'user',
          phase: 'verification',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }

    await executeWorkflow(workflow, {
      ...options,
      resumeFromStep: 'pause',
    })

    // On resume, the user step should not set phase to 'waiting'
    // setPhase should not have been called with 'waiting'
    const waitingCalls = setPhase.mock.calls.filter((call: any[]) => call[1] === 'waiting')
    expect(waitingCalls).toHaveLength(0)
  })

  it('updates mode when transitioning between agent steps with different agentIds', async () => {
    const multiStepWorkflow: WorkflowDefinition = {
      metadata: { id: 'test', name: 'Test', description: '', version: '1' },
      entryStep: 'step1',
      settings: { maxIterations: 10 },
      steps: [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'agent',
          phase: 'build',
          agentId: 'builder',
          transitions: [{ when: { type: 'always' }, goto: 'step2' }],
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'agent',
          phase: 'verification',
          agentId: 'planner',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }

    await executeWorkflow(multiStepWorkflow, options)

    expect(setMode).toHaveBeenCalledTimes(2)
    expect(setMode).toHaveBeenNthCalledWith(1, 'test-session', 'builder')
    expect(setMode).toHaveBeenNthCalledWith(2, 'test-session', 'planner')
  })

  it('does not cancel workflow execution on abort during agent step', async () => {
    const abortController = new AbortController()

    // Make runAgentTurn throw 'Aborted' when called, simulating user hitting Escape
    const { runAgentTurn: runAgentTurnModule } = await import('../chat/orchestrator.js')
    vi.mocked(runAgentTurnModule).mockImplementationOnce(async () => {
      abortController.abort()
      throw new Error('Aborted')
    })

    // executeWorkflow should throw 'Aborted' since we don't catch it in the executor
    await expect(
      executeWorkflow(workflow, {
        ...options,
        signal: abortController.signal,
      }),
    ).rejects.toThrow('Aborted')

    // cancelWorkflow should NOT have been called — abort preserves the execution
    expect(mockSessionManager.cancelWorkflow).not.toHaveBeenCalled()
  })

  it('can resume workflow after abort during agent step', async () => {
    const abortController = new AbortController()

    // Step 1: Start workflow, abort during agent step
    const { runAgentTurn: runAgentTurnModule } = await import('../chat/orchestrator.js')
    vi.mocked(runAgentTurnModule).mockImplementationOnce(async () => {
      abortController.abort()
      throw new Error('Aborted')
    })

    await expect(
      executeWorkflow(workflow, {
        ...options,
        signal: abortController.signal,
      }),
    ).rejects.toThrow('Aborted')

    // cancelWorkflow should NOT have been called
    expect(mockSessionManager.cancelWorkflow).not.toHaveBeenCalled()

    // Step 2: Resume the workflow from the aborted step
    // The execution is still 'running' in the DB (not cancelled)
    // Simulate what the WS server does: pass resumeFromStep
    mockSessionManager.getActiveWorkflowExecution.mockReturnValue({
      id: 'exec-1',
      sessionId: 'test-session',
      workflowId: 'test',
      workflowName: 'Test',
      status: 'running',
      currentStepId: 'build',
      currentStepName: 'Builder',
      stepOutput: {},
      params: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    // Reset the runAgentTurn mock to the default (step_done called)
    vi.mocked(runAgentTurnModule).mockImplementation(
      async (_opts: any, _metrics: any, _agentId: string, _append: any, extra: any) => {
        extra?.onToolExecuted?.({ name: 'step_done', arguments: {} }, { success: true, output: '' })
        return { returnValueResult: 'completed', returnValueContent: '' }
      },
    )

    const result = await executeWorkflow(workflow, {
      ...options,
      resumeFromStep: 'build',
      initialStepOutput: {},
    })

    // Should complete successfully (reach $done)
    expect(result.finalAction).toHaveProperty('type', 'DONE')
  })
})
