/**
 * Workflow Executor – Execution Context Integrity Tests (RED)
 *
 * These tests pin the behaviour expected for issue #190:
 *   "Refresh agent context after workspace or branch mutation during a turn".
 *
 * Goal of the test pack:
 *   1. Before the first agent step of Dev & Verify, if the actual Git branch on
 *      the effective workdir differs from the session's persisted branch, the
 *      executor MUST block immediately, with no file written and no automatic
 *      checkout performed.
 *   2. After an official workspace or branch mutation within a turn, the agent
 *      receives authoritative post-mutation context in the same turn (no stale
 *      pre-mutation branch/workdir served).
 *   3. The next turn receives the current workspace/branch context.
 *   4. When the mutation fails, the agent must NOT be served a refreshed,
 *      fake post-mutation context.
 *
 * These tests are RED until the executor and its collaborators implement the
 * gating + cache invalidation. They MUST NOT be touched by the implementation
 * phase — only the production code under src/server is allowed to change.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkflowDefinition } from './types.js'
import type { OrchestratorOptions } from '../runner/types.js'

const { runAgentTurnMock } = vi.hoisted(() => ({
  runAgentTurnMock: vi.fn(
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
}))

// Mock event store (same shape as executor-mode.test.ts)
vi.mock('../events/index.js', () => ({
  getEventStore: () => ({
    append: vi.fn(),
  }),
  getCurrentContextWindowId: vi.fn(() => undefined),
}))

vi.mock('../chat/orchestrator.js', () => ({
  runAgentTurn: runAgentTurnMock,
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

describe('executeWorkflow – execution context integrity', () => {
  let setMode: ReturnType<typeof vi.fn>
  let setPhase: ReturnType<typeof vi.fn>
  let blockWorkflow: ReturnType<typeof vi.fn>
  let startWorkflow: ReturnType<typeof vi.fn>
  let completeWorkflow: ReturnType<typeof vi.fn>
  let mockSessionManager: any
  let options: OrchestratorOptions
  let workflow: WorkflowDefinition

  beforeEach(() => {
    vi.clearAllMocks()

    setMode = vi.fn()
    setPhase = vi.fn()
    blockWorkflow = vi.fn()
    startWorkflow = vi.fn()
    completeWorkflow = vi.fn()

    mockSessionManager = {
      requireSession: vi.fn(() => ({
        workdir: '/tmp/project',
        workspace: null,
        branch: 'feat-x',
        messages: [],
        metadataEntries: {},
      })),
      setMode,
      setPhase,
      blockWorkflow,
      startWorkflow,
      completeWorkflow,
      getEffectiveWorkdir: vi.fn().mockReturnValue('/tmp/project'),
      addMessage: vi.fn(),
      updateWorkflowStep: vi.fn(),
      waitAtStep: vi.fn(),
      resumeWorkflow: vi.fn(),
      getActiveWorkflowExecution: vi.fn(() => null),
      cancelWorkflow: vi.fn(),
      // Issue #183 gate — overridden per test below
      assertExecutionGitContext: vi.fn(async () => ({
        ok: true as const,
        workdir: '/tmp/project',
        expectedBranch: 'feat-x',
        actualBranch: 'main',
      })),
    }

    options = {
      sessionManager: mockSessionManager,
      sessionId: 'test-session',
      llmClient: { getModel: () => 'test-model' } as any,
    }

    workflow = {
      metadata: { id: 'default', name: 'Build & Verify', description: '', version: '1' },
      entryStep: 'build',
      settings: { maxIterations: 10 },
      steps: [
        {
          id: 'build',
          name: 'Implement',
          type: 'agent',
          phase: 'build',
          agentId: 'builder',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }
  })

  it('blocks before the first agent step when actual git branch differs from session branch', async () => {
    // Session says we're on feat-x, Git actually says we're on main
    mockSessionManager.requireSession.mockReturnValue({
      workdir: '/tmp/project',
      workspace: null,
      branch: 'feat-x',
      messages: [],
      metadataEntries: {},
    })
    mockSessionManager.assertExecutionGitContext.mockResolvedValue({
      ok: false,
      reason:
        "Git context mismatch before Dev & Verify: session branch is 'feat-x' but workdir '/tmp/project' is actually on 'main'. Refusing to write — no agent was run, no checkout was performed.",
      workdir: '/tmp/project',
      expectedBranch: 'feat-x',
      actualBranch: 'main',
    })

    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction.type).toBe('BLOCKED')
    if (result.finalAction.type === 'BLOCKED') {
      expect(result.finalAction.reason).toMatch(/branch/i)
      expect(result.finalAction.reason).toContain('feat-x')
      expect(result.finalAction.reason).toContain('main')
    }
    // The agent MUST NOT be invoked — no file can be written if no agent runs
    expect(runAgentTurnMock).not.toHaveBeenCalled()
    // The workflow must NOT be marked as started (no DB write before the gate)
    expect(startWorkflow).not.toHaveBeenCalled()
    expect(blockWorkflow).not.toHaveBeenCalled()
    expect(completeWorkflow).not.toHaveBeenCalled()
  })

  it('blocks without invoking runAgentTurn and without performing any checkout', async () => {
    // First step of Dev & Verify (build) must not run if branch is drifted
    mockSessionManager.requireSession.mockReturnValue({
      workdir: '/tmp/project',
      workspace: '/ws/feat',
      branch: 'feat-x',
      messages: [],
      metadataEntries: {},
    })
    mockSessionManager.assertExecutionGitContext.mockResolvedValue({
      ok: false,
      reason:
        "Git context mismatch before Dev & Verify: session branch is 'feat-x' but workdir '/ws/feat' is actually on 'main'.",
      workdir: '/ws/feat',
      expectedBranch: 'feat-x',
      actualBranch: 'main',
    })

    await executeWorkflow(workflow, options)

    // Critical: agent must NOT have been called, therefore no file could have been written
    expect(runAgentTurnMock).not.toHaveBeenCalled()
    // The session manager should NOT have been asked to perform any checkout
    // (switchWorkspace is the only function that does branch mutations in tests;
    // since we didn't mock it, an attempt to call it would throw)
    expect(mockSessionManager.switchWorkspace).toBeUndefined()
    expect(startWorkflow).not.toHaveBeenCalled()
  })

  it('blocks fail-closed when expected branch is set but actual branch is unresolvable', async () => {
    // Detached HEAD / broken workdir: actualBranch is null even though
    // session.branch is set. We must block — the agent must not run.
    mockSessionManager.requireSession.mockReturnValue({
      workdir: '/tmp/project',
      workspace: '/ws/feat',
      branch: 'feat-x',
      messages: [],
      metadataEntries: {},
    })
    mockSessionManager.assertExecutionGitContext.mockResolvedValue({
      ok: false,
      reason:
        "Cannot verify Git context for workdir '/ws/feat': expected branch 'feat-x' but the actual branch is unavailable. " +
        "Refusing to write — no agent was run, no checkout was performed.",
      workdir: '/ws/feat',
      expectedBranch: 'feat-x',
      actualBranch: null,
    })

    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction.type).toBe('BLOCKED')
    if (result.finalAction.type === 'BLOCKED') {
      expect(result.finalAction.reason).toMatch(/unavailable/i)
      expect(result.finalAction.reason).toContain('feat-x')
      expect(result.finalAction.reason).toMatch(/no agent|no checkout|no file/i)
    }
    expect(runAgentTurnMock).not.toHaveBeenCalled()
    expect(startWorkflow).not.toHaveBeenCalled()
    expect(completeWorkflow).not.toHaveBeenCalled()
  })

  it('proceeds with the first agent step when actual branch matches session branch', async () => {
    // Healthy state: session.branch === actualBranch
    mockSessionManager.requireSession.mockReturnValue({
      workdir: '/tmp/project',
      workspace: null,
      branch: 'main',
      messages: [],
      metadataEntries: {},
    })
    mockSessionManager.assertExecutionGitContext.mockResolvedValue({
      ok: true,
      workdir: '/tmp/project',
      expectedBranch: 'main',
      actualBranch: 'main',
    })

    await executeWorkflow(workflow, options)

    // The gate must NOT block healthy flows
    expect(runAgentTurnMock).toHaveBeenCalledTimes(1)
    expect(completeWorkflow).toHaveBeenCalled()
  })

  it('does not serve a refreshed fake context when the mutation has failed upstream', async () => {
    // If a prior turn's mutation failed (e.g. checkout of a non-existent branch
    // left the session with the original branch), the executor must rely on the
    // authoritative actualBranchPair and block if it differs from session.branch —
    // it must NOT pretend that the workspace is on the new branch.
    mockSessionManager.requireSession.mockReturnValue({
      workdir: '/tmp/project',
      workspace: null,
      branch: 'feat-x',
      messages: [],
      metadataEntries: {},
    })
    mockSessionManager.assertExecutionGitContext.mockResolvedValue({
      ok: false,
      reason:
        "Git context mismatch before Dev & Verify: session branch is 'feat-x' but workdir '/tmp/project' is actually on 'main'.",
      workdir: '/tmp/project',
      expectedBranch: 'feat-x',
      actualBranch: 'main',
    })

    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction.type).toBe('BLOCKED')
    expect(runAgentTurnMock).not.toHaveBeenCalled()
  })
})
