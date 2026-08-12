import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMessage } from '../../shared/protocol.js'

const runOrchestratorMock = vi.fn()

vi.mock('./index.js', () => ({
  runOrchestrator: (...args: unknown[]) => runOrchestratorMock(...args),
}))

import { launchWorkflowRun, abortRunnerRun } from './launch.js'

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('launchWorkflowRun', () => {
  let sessionManager: {
    setRunning: ReturnType<typeof vi.fn>
    getActiveWorkflowExecution: ReturnType<typeof vi.fn>
    getLatestWorkflowExecution: ReturnType<typeof vi.fn>
    resumeWorkflow: ReturnType<typeof vi.fn>
  }
  let broadcast: ReturnType<typeof vi.fn>
  let onFinished: ReturnType<typeof vi.fn>
  let controller: AbortController

  beforeEach(() => {
    runOrchestratorMock.mockReset()
    sessionManager = {
      setRunning: vi.fn(),
      getActiveWorkflowExecution: vi.fn(() => null),
      getLatestWorkflowExecution: vi.fn(() => null),
      resumeWorkflow: vi.fn(),
    }
    broadcast = vi.fn()
    onFinished = vi.fn()
    controller = new AbortController()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const run = (payload: Record<string, unknown> = {}) =>
    launchWorkflowRun(
      {
        sessionManager: sessionManager as never,
        sessionId: 'sess-1',
        controller,
        llmClient: { getModel: () => 'm', getBackend: () => 'openai' } as never,
        statsIdentity: { providerId: 'p', providerName: 'pn', backend: 'openai', model: 'm' },
        broadcastForSession: broadcast as never,
        onFinished: onFinished as never,
      },
      payload as never,
    )

  it('marks the session running before the run and idle after it', async () => {
    runOrchestratorMock.mockResolvedValue({ finalAction: { type: 'DONE' }, iterations: 1, totalTime: 1 })
    run({ workflowId: 'wf' })
    await flush()

    expect(sessionManager.setRunning).toHaveBeenNthCalledWith(1, 'sess-1', true)
    expect(sessionManager.setRunning).toHaveBeenLastCalledWith('sess-1', false)
    const runningTrue = broadcast.mock.calls.find(
      ([, msg]) => msg.type === 'session.running' && msg.payload.isRunning === true,
    )
    const runningFalse = broadcast.mock.calls.find(
      ([, msg]) => msg.type === 'session.running' && msg.payload.isRunning === false,
    )
    expect(runningTrue).toBeTruthy()
    expect(runningFalse).toBeTruthy()
    expect(onFinished).toHaveBeenCalledTimes(1)
  })

  it('passes workflowId, params and a normalized scope to the orchestrator', async () => {
    runOrchestratorMock.mockResolvedValue({ finalAction: { type: 'DONE' }, iterations: 1, totalTime: 1 })
    run({ workflowId: 'wf', params: { a: '1' }, scope: 'user' })
    await flush()

    const options = runOrchestratorMock.mock.calls[0]![0]
    expect(options.workflowId).toBe('wf')
    expect(options.params).toEqual({ a: '1' })
    expect(options.scope).toBe('user')
    expect(options.sessionId).toBe('sess-1')
    expect(typeof options.onMessage).toBe('function')
  })

  it('normalizes an invalid scope to auto', async () => {
    runOrchestratorMock.mockResolvedValue({ finalAction: { type: 'DONE' }, iterations: 1, totalTime: 1 })
    run({ workflowId: 'wf', scope: 'bogus' })
    await flush()
    expect(runOrchestratorMock.mock.calls[0]![0].scope).toBe('auto')
  })

  it('builds a userMessage from content and attachments', async () => {
    runOrchestratorMock.mockResolvedValue({ finalAction: { type: 'DONE' }, iterations: 1, totalTime: 1 })
    run({ content: 'hello', attachments: [{ id: 'a1' }] })
    await flush()
    expect(runOrchestratorMock.mock.calls[0]![0].userMessage).toEqual({
      content: 'hello',
      attachments: [{ id: 'a1' }],
    })
  })

  it('omits userMessage when there is no content or attachments', async () => {
    runOrchestratorMock.mockResolvedValue({ finalAction: { type: 'DONE' }, iterations: 1, totalTime: 1 })
    run({ workflowId: 'wf' })
    await flush()
    expect('userMessage' in runOrchestratorMock.mock.calls[0]![0]).toBe(false)
  })

  it('surfaces orchestrator errors as chat.error', async () => {
    runOrchestratorMock.mockRejectedValue(new Error('Missing required parameter: x'))
    run({ workflowId: 'wf' })
    await flush()

    const errorMsg = broadcast.mock.calls.find(([, msg]) => msg.type === 'chat.error')?.[1] as ServerMessage<{
      error: string
    }>
    expect(errorMsg).toBeTruthy()
    expect(errorMsg.payload.error).toContain('Missing required parameter: x')
  })

  it('does not surface a chat.error for a controlled abort', async () => {
    runOrchestratorMock.mockRejectedValue(new Error('Aborted'))
    run({ workflowId: 'wf' })
    await flush()

    expect(broadcast.mock.calls.some(([msg]) => msg.type === 'chat.error')).toBe(false)
    expect(sessionManager.setRunning).toHaveBeenLastCalledWith('sess-1', false)
  })

  it('calls onFinished even when the orchestrator rejects', async () => {
    runOrchestratorMock.mockRejectedValue(new Error('boom'))
    run({ workflowId: 'wf' })
    await flush()
    expect(onFinished).toHaveBeenCalledTimes(1)
  })

  it('re-activates a blocked execution when retrying its step', async () => {
    runOrchestratorMock.mockResolvedValue({ finalAction: { type: 'DONE' }, iterations: 1, totalTime: 1 })
    sessionManager.getLatestWorkflowExecution = vi.fn(() => ({
      id: 'exec-1',
      sessionId: 'sess-1',
      workflowId: 'default',
      workflowName: 'Build & Verify',
      status: 'blocked',
      currentStepId: 'build',
      currentStepName: 'Implement',
      stepOutput: { content: 'x' },
      params: { feature: 'f' },
    }))
    sessionManager.resumeWorkflow = vi.fn(() => ({ params: { feature: 'f' }, stepOutput: { content: 'x' } }))

    run({ workflowId: 'default', resumeFrom: 'build' })
    await flush()

    // The blocked execution is flipped back to 'running' (reused id)
    expect(sessionManager.resumeWorkflow).toHaveBeenCalledWith(
      'sess-1',
      'exec-1',
      'default',
      'Build & Verify',
      undefined,
    )
    const options = runOrchestratorMock.mock.calls[0]![0]
    expect(options.resumeFromStep).toBe('build')
    expect(options.params).toEqual({ feature: 'f' })
    expect(options.initialStepOutput).toEqual({ content: 'x' })
  })
})

describe('abortRunnerRun', () => {
  it('aborts a registered run and reports success', async () => {
    runOrchestratorMock.mockImplementation(() => new Promise(() => {}))
    const controller = new AbortController()
    const abortSpy = vi.spyOn(controller, 'abort')

    launchWorkflowRun(
      {
        sessionManager: {
          setRunning: vi.fn(),
          getActiveWorkflowExecution: vi.fn(() => null),
          resumeWorkflow: vi.fn(),
        } as never,
        sessionId: 'sess-abort',
        controller,
        llmClient: {} as never,
        statsIdentity: { providerId: 'p', providerName: 'pn', backend: 'openai', model: 'm' },
        broadcastForSession: vi.fn() as never,
      },
      { workflowId: 'wf' } as never,
    )
    expect(abortRunnerRun('sess-abort')).toBe(true)
    expect(abortSpy).toHaveBeenCalled()

    // A second abort reports false (nothing running).
    expect(abortRunnerRun('sess-abort')).toBe(true)
  })

  it('returns false when nothing is running for the session', () => {
    expect(abortRunnerRun('sess-none')).toBe(false)
  })
})
