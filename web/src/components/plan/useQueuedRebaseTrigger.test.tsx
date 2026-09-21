// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useQueuedRebaseTrigger } from './useQueuedRebaseTrigger'
import { SessionScopeProvider } from '../../stores/session/session-scope'

const { triggerPendingUpdateMock } = vi.hoisted(() => ({
  triggerPendingUpdateMock: vi.fn(),
}))

let storeState: Record<string, unknown> = {}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector(storeState),
}))

vi.mock('../../lib/ws', () => ({
  wsClient: {
    send: vi.fn(() => 'request-1'),
  },
}))

function makePane(id: string, isRunning: boolean) {
  return {
    session: { id, projectId: 'p1', metadata: { title: `Title ${id}` }, isRunning },
    messages: [],
    hiddenCount: 0,
    currentTodos: [],
    contextState: null,
    subAgentContextStates: {},
    pendingPathConfirmations: [],
    pendingQuestions: [],
    visionFallbackByMessage: {},
    queuedMessages: [],
    abortInProgress: false,
    restoredInput: null,
    activeWorkflowExecution: null,
    gitStatus: null,
    error: null,
  }
}

function makeBaseState() {
  return {
    focusedSessionId: 's1',
    currentSession: null,
    contextState: null,
    pendingUpdate: null,
    queueUpdate: vi.fn(),
    triggerPendingUpdate: triggerPendingUpdateMock,
    panes: { s1: makePane('s1', false), s2: makePane('s2', false) },
  }
}

describe('useQueuedRebaseTrigger', () => {
  beforeEach(() => {
    storeState = makeBaseState()
    triggerPendingUpdateMock.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('triggers the queued rebase when the pending session stops running', () => {
    const { rerender } = renderHook(() => useQueuedRebaseTrigger(), {
      wrapper: ({ children }) => <SessionScopeProvider value="s1">{children}</SessionScopeProvider>,
    })

    // Session starts running
    storeState.panes = { s1: makePane('s1', true), s2: makePane('s2', false) }
    rerender()

    // A rebase was queued for this session, then it stops running
    storeState.pendingUpdate = 's1'
    storeState.panes = { s1: makePane('s1', false), s2: makePane('s2', false) }
    act(() => rerender())

    expect(triggerPendingUpdateMock).toHaveBeenCalledTimes(1)
  })

  it('does not trigger the pending update for a different session', () => {
    const { rerender } = renderHook(() => useQueuedRebaseTrigger(), {
      wrapper: ({ children }) => <SessionScopeProvider value="s1">{children}</SessionScopeProvider>,
    })

    storeState.panes = { s1: makePane('s1', false), s2: makePane('s2', false) }
    rerender()
    storeState.pendingUpdate = 's2'
    storeState.panes = { s1: makePane('s1', true), s2: makePane('s2', true) }
    act(() => rerender())

    expect(triggerPendingUpdateMock).not.toHaveBeenCalled()
  })
})
