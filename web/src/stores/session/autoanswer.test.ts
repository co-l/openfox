// @vitest-environment happy-dom
/**
 * Ask-user auto-answer countdown UI state
 *
 * - chat.ask_user + chat.autoanswer (active) → deadline attached to the question
 * - chat.autoanswer (inactive) → deadline removed
 * - cancelAutoAnswers → WS cancel message + immediate local clear
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))

const fetchMock = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }), status: 200 }),
)
vi.stubGlobal('fetch', fetchMock)
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
})

const { wsSendMock } = vi.hoisted(() => ({
  wsSendMock: vi.fn(() => 'message-id'),
}))

vi.mock('../../lib/ws', () => ({
  wsClient: {
    send: wsSendMock,
    subscribe: vi.fn(() => () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(() => undefined),
    onStatusChange: vi.fn(() => undefined),
  },
}))

vi.mock('../../lib/sound', () => ({
  playNotification: vi.fn(),
  playAchievement: vi.fn(),
  playIntervention: vi.fn(),
  playWaitingForUser: vi.fn(),
  playNewMessage: vi.fn(),
}))

type SessionStoreModule = typeof import('../session')

async function loadSessionStore(): Promise<SessionStoreModule['useSessionStore']> {
  vi.resetModules()
  const module = await import('../session')
  return module.useSessionStore
}

function makeSession(id: string) {
  return {
    id,
    projectId: 'project-1',
    workdir: '/tmp/project-1',
    mode: 'builder',
    phase: 'build',
    isRunning: true,
    criteria: [],
    summary: null,
    messages: [],
  } as any
}

function setBaseState(useSessionStore: any, session: any) {
  useSessionStore.setState((state: any) => ({
    ...state,
    currentSession: session,
    pendingQuestions: [],
  }))
}

const deadline = Date.now() + 120_000

function askMessage(callId: string) {
  return {
    type: 'chat.ask_user',
    sessionId: 'session-1',
    payload: { callId, question: 'Pick one:', type: 'choice', options: [{ value: 'A', label: 'A' }] },
  } as any
}

describe('ask-user auto-answer UI state', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    fetchMock.mockClear()
  })

  it('chat.autoanswer (active) attaches the deadline to the matching question', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))

    useSessionStore.getState().handleServerMessage(askMessage('call-1'))
    useSessionStore.getState().handleServerMessage({
      type: 'chat.autoanswer',
      sessionId: 'session-1',
      payload: { active: true, callId: 'call-1', deadline },
    })

    const question = useSessionStore.getState().pendingQuestions[0]!
    expect(question.callId).toBe('call-1')
    expect(question.autoAnswerDeadline).toBe(deadline)
  })

  it('chat.autoanswer (inactive) clears only the matching question deadline', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))

    useSessionStore.getState().handleServerMessage(askMessage('call-1'))
    useSessionStore.getState().handleServerMessage(askMessage('call-2'))
    useSessionStore.getState().handleServerMessage({
      type: 'chat.autoanswer',
      sessionId: 'session-1',
      payload: { active: true, callId: 'call-1', deadline },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.autoanswer',
      sessionId: 'session-1',
      payload: { active: true, callId: 'call-2', deadline: deadline + 5000 },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.autoanswer',
      sessionId: 'session-1',
      payload: { active: false, callId: 'call-1' },
    })

    const questions = useSessionStore.getState().pendingQuestions
    expect(questions.find((q) => q.callId === 'call-1')!.autoAnswerDeadline).toBeUndefined()
    expect(questions.find((q) => q.callId === 'call-2')!.autoAnswerDeadline).toBe(deadline + 5000)
  })

  it('chat.autoanswer (answered) drops the question answered server-side on expiry', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))

    useSessionStore.getState().handleServerMessage(askMessage('call-1'))
    useSessionStore.getState().handleServerMessage({
      type: 'chat.autoanswer',
      sessionId: 'session-1',
      payload: { active: true, callId: 'call-1', deadline },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.autoanswer',
      sessionId: 'session-1',
      payload: { active: false, callId: 'call-1', answered: true },
    })

    expect(useSessionStore.getState().pendingQuestions).toHaveLength(0)
  })

  it('cancelAutoAnswers sends the WS cancel message and clears locally; no-op without a countdown', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))

    useSessionStore.getState().cancelAutoAnswers('session-1')
    expect(wsSendMock).not.toHaveBeenCalled()

    useSessionStore.getState().handleServerMessage(askMessage('call-1'))
    useSessionStore.getState().handleServerMessage({
      type: 'chat.autoanswer',
      sessionId: 'session-1',
      payload: { active: true, callId: 'call-1', deadline },
    })

    useSessionStore.getState().cancelAutoAnswers('session-1')
    expect(wsSendMock).toHaveBeenCalledWith('chat.cancel_autoanswer', { sessionId: 'session-1' })
    expect(useSessionStore.getState().pendingQuestions[0]!.autoAnswerDeadline).toBeUndefined()
  })
})
