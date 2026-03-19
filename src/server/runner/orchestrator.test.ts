import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  decideNextActionMock,
  getEventStoreMock,
  runBuilderTurnMock,
  runVerifierTurnMock,
} = vi.hoisted(() => ({
  decideNextActionMock: vi.fn(),
  getEventStoreMock: vi.fn(),
  runBuilderTurnMock: vi.fn(),
  runVerifierTurnMock: vi.fn(),
}))

vi.mock('./decision.js', () => ({
  decideNextAction: decideNextActionMock,
}))

vi.mock('../events/index.js', () => ({
  getEventStore: getEventStoreMock,
}))

vi.mock('../chat/orchestrator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chat/orchestrator.js')>()
  return {
    ...actual,
    runBuilderTurn: runBuilderTurnMock,
    runVerifierTurn: runVerifierTurnMock,
  }
})

import { runOrchestrator } from './orchestrator.js'

function createEventStore() {
  return {
    append: vi.fn(),
  }
}

function createSessionManager(criteria: Array<Record<string, unknown>>) {
  return {
    requireSession: vi.fn(() => ({ criteria })),
    setPhase: vi.fn(),
  }
}

describe('runner orchestrator', () => {
  beforeEach(() => {
    decideNextActionMock.mockReset()
    getEventStoreMock.mockReset()
    runBuilderTurnMock.mockReset()
    runVerifierTurnMock.mockReset()
  })

  it('returns done immediately when all criteria pass', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    decideNextActionMock.mockReturnValue({ type: 'DONE', reason: 'All criteria passed' })
    const sessionManager = createSessionManager([])

    const result = await runOrchestrator({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: {} as never,
    })

    expect(sessionManager.setPhase).toHaveBeenCalledWith('session-1', 'done')
    expect(eventStore.append).toHaveBeenCalledWith('session-1', { type: 'phase.changed', data: { phase: 'done' } })
    expect(result.finalAction).toEqual({ type: 'DONE', reason: 'All criteria passed' })
  })

  it('marks the runner blocked and injects a correction message', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    decideNextActionMock.mockReturnValue({ type: 'BLOCKED', reason: 'Need user input', blockedCriteria: ['tests-pass'] })
    const sessionManager = createSessionManager([])

    const result = await runOrchestrator({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: {} as never,
    })

    expect(sessionManager.setPhase).toHaveBeenCalledWith('session-1', 'blocked')
    expect(eventStore.append.mock.calls.some(([_, event]) => event.type === 'message.start' && String((event.data as any).content).includes('Runner blocked: Need user input'))).toBe(true)
    expect(result.finalAction).toEqual({ type: 'BLOCKED', reason: 'Need user input', blockedCriteria: ['tests-pass'] })
  })

  it('runs verifier then builder loops before finishing', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    decideNextActionMock
      .mockReturnValueOnce({ type: 'RUN_VERIFIER', reason: 'Need verification' })
      .mockReturnValueOnce({ type: 'RUN_BUILDER', reason: 'Fix failed criterion' })
      .mockReturnValueOnce({ type: 'DONE', reason: 'All criteria passed' })
    const sessionManager = createSessionManager([{ id: 'tests-pass' }])

    const result = await runOrchestrator({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: {} as never,
      onMessage: vi.fn(),
    })

    expect(sessionManager.setPhase).toHaveBeenNthCalledWith(1, 'session-1', 'verification')
    expect(sessionManager.setPhase).toHaveBeenNthCalledWith(2, 'session-1', 'build')
    expect(sessionManager.setPhase).toHaveBeenLastCalledWith('session-1', 'done')
    expect(runVerifierTurnMock).toHaveBeenCalledTimes(1)
    expect(runBuilderTurnMock).toHaveBeenCalledTimes(1)
    expect(eventStore.append.mock.calls.some(([_, event]) => event.type === 'message.start' && String((event.data as any).content).includes('Continue working on the acceptance criteria'))).toBe(true)
    expect(result.finalAction.type).toBe('DONE')
  })

  it('returns early on abort and blocks after max iterations', async () => {
    const abortStore = createEventStore()
    getEventStoreMock.mockReturnValue(abortStore)
    const controller = new AbortController()
    controller.abort()
    const sessionManager = createSessionManager([])

    const aborted = await runOrchestrator({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: {} as never,
      signal: controller.signal,
    })

    expect(aborted.finalAction).toEqual({ type: 'RUN_BUILDER', reason: 'Aborted' })

    const maxStore = createEventStore()
    getEventStoreMock.mockReturnValue(maxStore)
    decideNextActionMock.mockReturnValue({ type: 'RUN_BUILDER', reason: 'Still working' })
    const loopingManager = createSessionManager([{ id: 'tests-pass' }])

    const blocked = await runOrchestrator({
      sessionManager: loopingManager as never,
      sessionId: 'session-1',
      llmClient: {} as never,
    })

    expect(loopingManager.setPhase).toHaveBeenLastCalledWith('session-1', 'blocked')
    expect(maxStore.append.mock.calls.some(([_, event]) => event.type === 'message.start' && String((event.data as any).content).includes('Maximum iterations'))).toBe(true)
    expect(blocked.finalAction).toEqual({ type: 'BLOCKED', reason: 'Max iterations reached', blockedCriteria: [] })
  })
})
