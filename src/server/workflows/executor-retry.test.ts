/**
 * Workflow Executor – LLM Failure Tests
 *
 * When a workflow agent step's LLM call fails, the retry now happens INSIDE
 * the LLM stream layer (streamLLMPure, exponential backoff) — the executor
 * never sees the transient failures. Only a definitive give-up surfaces as a
 * failed turn result, and the executor simply blocks the workflow execution
 * (no rollback, no tombstones, no step_retry events — history stays clean).
 *
 * The existing "agent finished but forgot step_done()" nudge path is preserved:
 * a legitimate completion is NOT a failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkflowDefinition } from './types.js'
import type { OrchestratorOptions } from '../runner/types.js'
import { LLMError } from '../utils/errors.js'

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
    llmRetryPolicy: { backoffMs: [0, 0, 0, 0], minIntervalMs: 0, maxDurationMs: 60_000, maxAttempts: 40 },
    ...extra,
  }
}

function nudgeEvents(): any[] {
  return mockAppend.mock.calls.filter(
    (call: any[]) =>
      call[1]?.type === 'message.start' &&
      call[1]?.data?.isSystemGenerated &&
      typeof call[1]?.data?.content === 'string' &&
      (call[1]?.data?.content as string).includes("You haven't called step_done()"),
  )
}

function wireStepDone(call: { onToolExecuted?: (tc: any, tr: any) => void } | undefined): void {
  call?.onToolExecuted?.({ name: 'step_done', arguments: {} }, { success: true, output: '' })
}

// ============================================================================
// Tests
// ============================================================================

describe('workflow agent step LLM failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks the workflow when the agent turn reports a definitive LLM failure (no rollback, no retry loop)', async () => {
    mockRunAgentTurn.mockImplementation(async () => ({ failed: { error: 'LLM boom' } }))

    const workflow = createWorkflow()
    const onMessage = vi.fn()
    const options = createMockOptions({ onMessage })

    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction.type).toBe('BLOCKED')
    expect((result.finalAction as { reason: string }).reason).toContain('LLM boom')
    // Retries happen inside the LLM stream layer — the executor runs the turn exactly once
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1)
    // Nothing is rolled back, tombstoned, or removed — history stays clean
    const removedEvents = mockAppend.mock.calls
      .map((c: any[]) => c[1])
      .filter((e: any) => e?.type === 'message.removed')
    expect(removedEvents).toHaveLength(0)
    const retryEvents = mockAppend.mock.calls
      .map((c: any[]) => c[1])
      .filter((e: any) => e?.type === 'workflow.step_retry')
    expect(retryEvents).toHaveLength(0)
    // The step prompt stays in history — nothing re-injected on a later resume
    const promptEvents = mockAppend.mock.calls
      .map((c: any[]) => c[1])
      .filter(
        (call: any) =>
          call?.type === 'message.start' &&
          typeof call?.data?.content === 'string' &&
          (call.data.content as string).includes('Implement the feature'),
      )
    expect(promptEvents).toHaveLength(1)
    // Execution marked blocked for the user-triggered Retry (resume path)
    expect((options.sessionManager as any).setPhase).toHaveBeenCalledWith('test-session', 'blocked')
    expect((options.sessionManager as any).blockWorkflow).toHaveBeenCalled()
  })

  it('blocks the workflow when runAgentTurn throws an LLMError', async () => {
    mockRunAgentTurn.mockImplementation(async () => {
      throw new LLMError('LLM stream idle timeout')
    })

    const workflow = createWorkflow()
    const onMessage = vi.fn()
    const options = createMockOptions({ onMessage })
    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction.type).toBe('BLOCKED')
    expect((result.finalAction as { reason: string }).reason).toContain('LLM stream idle timeout')
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1)
    expect((options.sessionManager as any).blockWorkflow).toHaveBeenCalled()
  })

  it('does not roll back when the agent simply forgets step_done()', async () => {
    mockRunAgentTurn.mockImplementation(async () => ({ returnValueResult: 'completed' }))

    const workflow = createWorkflow()
    const result = await executeWorkflow(workflow, createMockOptions())

    // Agent completed its turn but never called step_done → nudge loop, no failure handling
    expect(result.finalAction.type).toBe('BLOCKED') // maxIterations exhausted without step_done
    const removedEvents = mockAppend.mock.calls
      .map((c: any[]) => c[1])
      .filter((e: any) => e?.type === 'message.removed')
    expect(removedEvents).toHaveLength(0)
    expect(nudgeEvents().length).toBeGreaterThan(0)
  })

  it('propagates non-LLM errors instead of masking them', async () => {
    mockRunAgentTurn.mockImplementation(async () => {
      throw new Error('internal bug')
    })

    const workflow = createWorkflow()
    await expect(executeWorkflow(workflow, createMockOptions())).rejects.toThrow('internal bug')
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1)
  })

  it('keeps the execution tracked when retrying a blocked step via resume', async () => {
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
        if (callCount === 1) return { failed: { error: 'boom' } }
        wireStepDone(extra)
        return { returnValueResult: 'completed' }
      },
    )

    const workflow = createWorkflow()

    // First run: the step fails definitively (retries happened in the stream
    // layer) and the execution is blocked for the user-triggered Retry.
    const firstOptions = createMockOptions()
    const firstResult = await executeWorkflow(workflow, firstOptions)
    expect(firstResult.finalAction.type).toBe('BLOCKED')
    expect((firstOptions.sessionManager as any).blockWorkflow).toHaveBeenCalled()

    // User clicks Retry: launchWorkflowRun re-activates the blocked execution
    // to 'running' and resumes from the same step — same execution id.
    const secondOptions = createMockOptions({ resumeFromStep: 'build', initialStepOutput: {} })
    ;(secondOptions.sessionManager as any).getActiveWorkflowExecution = vi.fn(() => ({
      id: 'exec-1',
      sessionId: 'test-session',
      workflowId: 'test',
      workflowName: 'Test',
      status: 'running',
      stepOutput: {},
      params: {},
    }))

    const secondResult = await executeWorkflow(workflow, secondOptions)

    expect(secondResult.finalAction.type).toBe('DONE')
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(2)
    // The run stayed tracked: the execution completed with the reused id
    const completeCall = (secondOptions.sessionManager as any).completeWorkflow.mock.calls[0] as unknown[]
    expect(completeCall[1]).toBe('exec-1')
  })
})
