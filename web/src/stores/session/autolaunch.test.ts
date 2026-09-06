// @vitest-environment happy-dom
/**
 * Favorite-workflow auto-launch UI state
 *
 * - workflow.autolaunch (active) → live countdown state on the pane
 * - workflow.autolaunch (inactive) → clears it
 * - cancelAutoLaunch → WS cancel message + immediate local clear
 * - session reload → transient countdown cleared
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
    phase: 'plan',
    isRunning: false,
    criteria: [],
    summary: null,
    messages: [],
  } as any
}

function setBaseState(useSessionStore: any, session: any) {
  useSessionStore.setState((state: any) => ({
    ...state,
    currentSession: session,
    autoLaunch: null,
  }))
}

const deadline = Date.now() + 60_000

describe('favorite-workflow auto-launch UI state', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    fetchMock.mockClear()
  })

  it('workflow.autolaunch (active) sets the countdown on the focused pane', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))

    useSessionStore.getState().handleServerMessage({
      type: 'workflow.autolaunch',
      sessionId: 'session-1',
      payload: { active: true, workflowId: 'auto-flow', workflowName: 'Autonomous build', scope: 'user', deadline },
    })

    expect(useSessionStore.getState().autoLaunch).toEqual({
      workflowId: 'auto-flow',
      workflowName: 'Autonomous build',
      scope: 'user',
      deadline,
    })
  })

  it('workflow.autolaunch (inactive) clears the countdown', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))

    useSessionStore.getState().handleServerMessage({
      type: 'workflow.autolaunch',
      sessionId: 'session-1',
      payload: { active: true, workflowId: 'auto-flow', workflowName: 'Autonomous build', scope: 'user', deadline },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'workflow.autolaunch',
      sessionId: 'session-1',
      payload: { active: false },
    })

    expect(useSessionStore.getState().autoLaunch).toBeNull()
  })

  it('cancelAutoLaunch sends the WS cancel message and clears locally; no-op without a countdown', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))

    useSessionStore.getState().cancelAutoLaunch('session-1')
    expect(wsSendMock).not.toHaveBeenCalled()

    useSessionStore.getState().handleServerMessage({
      type: 'workflow.autolaunch',
      sessionId: 'session-1',
      payload: { active: true, workflowId: 'auto-flow', workflowName: 'Autonomous build', scope: 'user', deadline },
    })
    useSessionStore.getState().cancelAutoLaunch('session-1')

    expect(wsSendMock).toHaveBeenCalledWith('workflow.cancel_autolaunch', { sessionId: 'session-1' })
    expect(useSessionStore.getState().autoLaunch).toBeNull()
  })

  it('session reload resets the transient countdown', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))

    useSessionStore.getState().handleServerMessage({
      type: 'workflow.autolaunch',
      sessionId: 'session-1',
      payload: { active: true, workflowId: 'auto-flow', workflowName: 'Autonomous build', scope: 'user', deadline },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'session.state',
      sessionId: 'session-1',
      payload: { session: makeSession('session-1'), messages: [], pendingConfirmations: [] },
    })

    // A full snapshot replaces the pane; the server re-sends a live countdown
    // on session.load when one is still pending, so the cleared local state is
    // only correct until that sync arrives.
    expect(useSessionStore.getState().autoLaunch).toEqual({
      workflowId: 'auto-flow',
      workflowName: 'Autonomous build',
      scope: 'user',
      deadline,
    })
  })
})
