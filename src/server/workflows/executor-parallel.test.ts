/**
 * Workflow Executor – Parallel Step Tests
 *
 * Verifies `parallel` step execution: concurrent children, the aggregate
 * result (success / partial / failure), per-child flat dotted stepOutput keys,
 * template resolution, maxConcurrency, abort, sub-group slices, and resume.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkflowDefinition, ParallelChildStep } from './types.js'
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
import { executeSubAgent } from '../sub-agents/manager.js'
import { executeShellCommand } from './shell.js'
import { findAgentById } from '../agents/registry.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Fixtures
// ============================================================================

interface ShellMockResult {
  stdout: string
  stderr: string
  exitCode: number
  success: boolean
}

function makeParallelWorkflow(
  overrides: { maxConcurrency?: number; children?: ParallelChildStep[] } = {},
): WorkflowDefinition {
  const { maxConcurrency, children } = overrides
  return {
    metadata: { id: 'parallel-wf', name: 'Parallel', description: '', version: '1' },
    entryStep: 'reviews',
    settings: { maxIterations: 20 },
    steps: [
      {
        id: 'reviews',
        name: 'Reviews',
        type: 'parallel',
        phase: 'verification',
        ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
        children: children ?? [
          { id: 'lint', type: 'shell', command: 'echo lint-out' },
          { id: 'format', type: 'shell', command: 'echo fmt-out' },
        ],
        transitions: [
          { when: { type: 'step_result', result: 'success' }, goto: 'report' },
          { when: { type: 'step_result', result: 'partial' }, goto: 'report' },
          { when: { type: 'step_result', result: 'failure' }, goto: 'report' },
          { when: { type: 'always' }, goto: 'report' },
        ],
      },
      {
        id: 'report',
        name: 'Report',
        type: 'shell',
        phase: 'verification',
        command: 'echo {{stepOutput.result}}',
        transitions: [{ when: { type: 'always' }, goto: '$done' }],
      },
    ],
  }
}

function makeHarness(criteria: MetadataEntry[] = []) {
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

/** The resolved command of the LAST shell invocation (the 'report' step). */
function lastReportCommand(): string {
  const calls = vi.mocked(executeShellCommand).mock.calls
  return calls[calls.length - 1]?.[0] ?? ''
}

describe('executeWorkflow parallel step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(executeShellCommand).mockImplementation(async (command: string) => ({
      stdout: command.replace('echo ', '').trim() + '\n',
      stderr: '',
      exitCode: 0,
      success: true,
    }))
    vi.mocked(findAgentById).mockImplementation((id: string) => ({ id, name: `Agent ${id}` }) as any)
    vi.mocked(executeSubAgent).mockImplementation(async () => ({ content: '', result: 'success' }))
  })

  it('aggregates all-success shell children as success with per-child flat dotted keys', async () => {
    const { options } = makeHarness()
    const workflow = makeParallelWorkflow()

    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction).toHaveProperty('type', 'DONE')
    // The report step consumed the aggregate result
    expect(lastReportCommand()).toBe('echo success')
    const childCommands = vi
      .mocked(executeShellCommand)
      .mock.calls.slice(0, 2)
      .map((c) => c[0])
    expect(childCommands).toEqual(['echo lint-out', 'echo fmt-out'])
  })

  it('aggregates mixed results as partial', async () => {
    const { options } = makeHarness()
    const workflow = makeParallelWorkflow({
      children: [
        { id: 'lint', type: 'shell', command: 'echo ok' },
        { id: 'broken', type: 'shell', command: 'exit 1' },
      ],
    })
    vi.mocked(executeShellCommand).mockImplementation(async (command: string) =>
      command === 'exit 1'
        ? { stdout: '', stderr: 'boom', exitCode: 1, success: false }
        : { stdout: command.replace('echo ', '') + '\n', stderr: '', exitCode: 0, success: true },
    )

    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction).toHaveProperty('type', 'DONE')
    expect(lastReportCommand()).toBe('echo partial')
  })

  it('aggregates all-failure children as failure', async () => {
    const { options } = makeHarness()
    const workflow = makeParallelWorkflow({
      children: [
        { id: 'a', type: 'shell', command: 'exit 1' },
        { id: 'b', type: 'shell', command: 'exit 2' },
      ],
    })
    vi.mocked(executeShellCommand).mockImplementation(async () => ({
      stdout: '',
      stderr: 'fail',
      exitCode: 1,
      success: false,
    }))

    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction).toHaveProperty('type', 'DONE')
    expect(lastReportCommand()).toBe('echo failure')
  })

  it('yields an error outcome for a shell child with no command instead of crashing', async () => {
    const { options } = makeHarness()
    const workflow = makeParallelWorkflow({
      // 'ghost' has no command field at all (as the editor produces after a type switch)
      children: [{ id: 'ghost', type: 'shell' } as never, { id: 'ok', type: 'shell', command: 'echo ok' }],
    })

    const result = await executeWorkflow(workflow, options)

    // The run completes; the command-less child is an error, so the aggregate is partial
    expect(result.finalAction).toHaveProperty('type', 'DONE')
    expect(lastReportCommand()).toBe('echo partial')
    expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
      'Shell child has no command',
      expect.objectContaining({ child: 'ghost' }),
    )
  })

  it('logs a warning when child ids are duplicated', async () => {
    const { options } = makeHarness()
    const workflow = makeParallelWorkflow({
      children: [
        { id: 'dup', type: 'shell', command: 'echo one' },
        { id: 'dup', type: 'shell', command: 'echo two' },
      ],
    })

    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction).toHaveProperty('type', 'DONE')
    expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
      'Parallel step has duplicate child ids',
      expect.objectContaining({ stepId: 'reviews' }),
    )
  })

  it('runs children concurrently (a child starts before its sibling resolves)', async () => {
    const { options } = makeHarness()
    const workflow = makeParallelWorkflow()
    const started: string[] = []
    let releaseSlow: (value: ShellMockResult) => void = () => {}
    const slowGate = new Promise<ShellMockResult>((resolve) => {
      releaseSlow = resolve
    })
    vi.mocked(executeShellCommand).mockImplementation(async (command: string) => {
      started.push(command)
      if (command === 'echo lint-out') {
        return slowGate
      }
      return { stdout: 'fmt-out\n', stderr: '', exitCode: 0, success: true }
    })

    const pending = executeWorkflow(workflow, options)
    await new Promise((r) => setTimeout(r, 20))
    // 'format' started while 'lint' is still pending
    expect(started).toEqual(['echo lint-out', 'echo fmt-out'])
    releaseSlow({ stdout: 'lint-out\n', stderr: '', exitCode: 0, success: true })

    const result = await pending
    expect(result.finalAction).toHaveProperty('type', 'DONE')
  })

  it('respects maxConcurrency: 1 (the second child waits for the first)', async () => {
    const { options } = makeHarness()
    const workflow = makeParallelWorkflow({ maxConcurrency: 1 })
    const started: string[] = []
    let releaseFirst: (value: ShellMockResult) => void = () => {}
    const firstGate = new Promise<ShellMockResult>((resolve) => {
      releaseFirst = resolve
    })
    vi.mocked(executeShellCommand).mockImplementation(async (command: string) => {
      started.push(command)
      if (command === 'echo lint-out') {
        return firstGate
      }
      return { stdout: 'fmt-out\n', stderr: '', exitCode: 0, success: true }
    })

    const pending = executeWorkflow(workflow, options)
    await new Promise((r) => setTimeout(r, 20))
    // With maxConcurrency 1 the second child must NOT have started
    expect(started).toEqual(['echo lint-out'])
    releaseFirst({ stdout: 'lint-out\n', stderr: '', exitCode: 0, success: true })

    const result = await pending
    expect(result.finalAction).toHaveProperty('type', 'DONE')
    // The report step appends its own command; the children ran strictly in order
    expect(started.slice(0, 2)).toEqual(['echo lint-out', 'echo fmt-out'])
  })

  it('resolves template variables in child commands against the pre-run context', async () => {
    const { options } = makeHarness()
    const workflow: WorkflowDefinition = {
      metadata: { id: 'tpl', name: 'Tpl', description: '', version: '1' },
      entryStep: 'setup',
      settings: { maxIterations: 10 },
      steps: [
        {
          id: 'setup',
          name: 'Setup',
          type: 'shell',
          phase: 'build',
          command: 'echo prev-out',
          transitions: [{ when: { type: 'always' }, goto: 'reviews' }],
        },
        {
          id: 'reviews',
          name: 'Reviews',
          type: 'parallel',
          phase: 'verification',
          children: [{ id: 'check', type: 'shell', command: 'echo {{stepOutput.stdout}} {{feature}} {{workdir}}' }],
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }
    const seen: string[] = []
    vi.mocked(executeShellCommand).mockImplementation(async (command: string) => {
      seen.push(command)
      const stdout = command.startsWith('echo') ? command.replace('echo ', '') + '\n' : ''
      return { stdout, stderr: '', exitCode: 0, success: true }
    })

    const result = await executeWorkflow(workflow, { ...options, params: { feature: 'parallel' } })

    expect(result.finalAction).toHaveProperty('type', 'DONE')
    // Child command resolved against the previous step's output (stdout keeps
    // its trailing newline) + params + workdir
    expect(seen[1]).toBe('echo prev-out\n parallel /tmp/test')
  })

  it('marks an unknown sub-agent type as an error without failing its siblings', async () => {
    const { options } = makeHarness()
    vi.mocked(findAgentById).mockImplementation((id: string) => (id === 'nope' ? undefined : ({ id, name: id } as any)))
    const workflow = makeParallelWorkflow({
      children: [
        { id: 'good', type: 'shell', command: 'echo ok' },
        { id: 'bad', type: 'sub_agent', subAgentType: 'nope', prompt: 'do it' },
      ],
    })

    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction).toHaveProperty('type', 'DONE')
    // One success + one error => partial
    expect(lastReportCommand()).toBe('echo partial')
    expect(vi.mocked(logger).error).toHaveBeenCalledWith('Sub-agent definition not found', { subAgentType: 'nope' })
  })

  it('feeds sub-agent child results into the flat stepOutput keys', async () => {
    const { options } = makeHarness()
    const workflow: WorkflowDefinition = {
      metadata: { id: 'sub-out', name: 'SubOut', description: '', version: '1' },
      entryStep: 'reviews',
      settings: { maxIterations: 10 },
      steps: [
        {
          id: 'reviews',
          name: 'Reviews',
          type: 'parallel',
          phase: 'verification',
          children: [
            { id: 'review', type: 'sub_agent', subAgentType: 'verifier', prompt: 'Verify {{workdir}}' },
            { id: 'lint', type: 'shell', command: 'echo clean' },
          ],
          transitions: [{ when: { type: 'always' }, goto: 'report' }],
        },
        {
          id: 'report',
          name: 'Report',
          type: 'shell',
          phase: 'verification',
          command: 'echo {{stepOutput.review.result}}|{{stepOutput.review.content}}|{{stepOutput.summary}}',
          transitions: [{ when: { type: 'always' }, goto: '$done' }],
        },
      ],
    }
    vi.mocked(executeSubAgent).mockImplementation(async () => ({ content: 'findings here', result: 'failed' }))

    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction).toHaveProperty('type', 'DONE')
    expect(lastReportCommand()).toBe('echo failed|findings here|- review: failed\n- lint: success')
  })

  it('returns failure with a warning log for a parallel step with no children', async () => {
    const { options } = makeHarness()
    const workflow = makeParallelWorkflow({ children: [] })
    // No shell children run; only the report step runs
    vi.mocked(executeShellCommand).mockImplementation(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    }))

    const result = await executeWorkflow(workflow, options)

    expect(result.finalAction).toHaveProperty('type', 'DONE')
    expect(lastReportCommand()).toBe('echo failure')
    expect(vi.mocked(logger).warn).toHaveBeenCalledWith('Parallel step has no children', expect.anything())
  })

  it('rethrows Aborted when the signal aborts mid-parallel', async () => {
    const { options } = makeHarness()
    const workflow = makeParallelWorkflow()
    const controller = new AbortController()
    const optionsWithSignal: OrchestratorOptions = { ...options, signal: controller.signal }
    const started: string[] = []
    vi.mocked(executeShellCommand).mockImplementation(
      (command: string, _cwd: string, _timeout: number, signal?: AbortSignal) => {
        started.push(command)
        return new Promise<ShellMockResult>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('Aborted'))
            return
          }
          signal?.addEventListener('abort', () => reject(new Error('Aborted')))
        })
      },
    )

    const pending = executeWorkflow(workflow, optionsWithSignal)
    // Wait until both children are in flight, then abort mid-parallel
    for (let i = 0; i < 200 && started.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(started).toHaveLength(2)
    controller.abort()

    await expect(pending).rejects.toThrow('Aborted')
  })

  it('runs a sub-group slice whose only step is a parallel parent', async () => {
    const { mockSessionManager, options } = makeHarness()
    const workflow = makeParallelWorkflow()
    workflow.steps[0]!.subGroup = 'reviews-group'
    workflow.steps[1]!.subGroup = 'reviews-group'

    const result = await executeWorkflow(workflow, options, 'reviews-group')

    expect(result.finalAction).toHaveProperty('type', 'DONE')
    expect(lastReportCommand()).toBe('echo success')
    // The slice name is persisted on the workflow execution
    const startArgs = mockSessionManager.startWorkflow.mock.calls[0]!
    expect(startArgs[startArgs.length - 1]).toBe('reviews-group')
  })

  it('re-runs all children when resuming at the parallel step', async () => {
    const { options } = makeHarness()
    const workflow = makeParallelWorkflow()

    const resumed = await executeWorkflow(workflow, { ...options, resumeFromStep: 'reviews' })

    expect(resumed.finalAction).toHaveProperty('type', 'DONE')
    // Both children ran on resume
    const commands = vi.mocked(executeShellCommand).mock.calls.map((c) => c[0])
    expect(commands.filter((c) => c === 'echo lint-out' || c === 'echo fmt-out')).toHaveLength(2)
    expect(lastReportCommand()).toBe('echo success')
  })
})
