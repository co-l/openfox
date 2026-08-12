// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SessionHeader } from './SessionHeader'
import { SessionScopeProvider } from '../../stores/session/session-scope'

const { sendMock, queueUpdateMock, triggerPendingUpdateMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  queueUpdateMock: vi.fn(),
  triggerPendingUpdateMock: vi.fn(),
}))

let storeState: Record<string, unknown> = {}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector(storeState),
}))

vi.mock('../../lib/ws', () => ({
  wsClient: {
    send: (...args: unknown[]) => {
      sendMock(...args)
      return 'request-1'
    },
  },
}))

vi.mock('./DynamicContextPreviewModal', () => ({
  DynamicContextPreviewModal: ({ onApply, isRunning }: { onApply: () => void; isRunning: boolean }) => (
    <div>
      {isRunning ? <span>running</span> : null}
      <button onClick={onApply}>apply</button>
    </div>
  ),
}))

function makeContextState(dynamicContextChanged: boolean) {
  return {
    currentTokens: 100,
    maxTokens: 1000,
    compactionCount: 0,
    dangerZone: false,
    canCompact: false,
    dynamicContextChanged,
  }
}

function makePane(id: string, opts: { changed?: boolean; isRunning?: boolean } = {}) {
  return {
    session: { id, projectId: 'p1', metadata: { title: `Title ${id}` }, isRunning: opts.isRunning ?? false },
    messages: [],
    hiddenCount: 0,
    currentTodos: [],
    contextState: makeContextState(opts.changed ?? false),
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
    queueUpdate: queueUpdateMock,
    triggerPendingUpdate: triggerPendingUpdateMock,
    panes: { s1: makePane('s1'), s2: makePane('s2') },
  }
}

describe('SessionHeader', () => {
  beforeEach(() => {
    storeState = makeBaseState()
    sendMock.mockClear()
    queueUpdateMock.mockClear()
    triggerPendingUpdateMock.mockClear()
  })

  afterEach(() => cleanup())

  it('shows the banner when the scoped session’s context changed', () => {
    storeState.panes = { s1: makePane('s1', { changed: true }), s2: makePane('s2') }
    render(
      <SessionScopeProvider value="s1">
        <SessionHeader />
      </SessionScopeProvider>,
    )
    expect(screen.getByText('System prompt has changed —')).toBeDefined()
  })

  it('does not leak the focused session’s changed flag into an unaffected pane', () => {
    storeState = {
      ...makeBaseState(),
      focusedSessionId: 's2',
      currentSession: { id: 's2', projectId: 'p1', metadata: { title: 'Focused' }, isRunning: false },
      contextState: makeContextState(true),
      panes: { s1: makePane('s1'), s2: makePane('s2', { changed: true }) },
    }
    render(
      <SessionScopeProvider value="s1">
        <SessionHeader />
      </SessionScopeProvider>,
    )
    expect(screen.queryByText('System prompt has changed —')).toBeNull()
  })

  it('still shows the banner in a single-session (unscoped) render from flat state', () => {
    storeState = {
      ...makeBaseState(),
      focusedSessionId: null,
      panes: {},
      currentSession: { id: 's1', projectId: 'p1', metadata: { title: 'Solo' }, isRunning: false },
      contextState: makeContextState(true),
      queueUpdate: queueUpdateMock,
      triggerPendingUpdate: triggerPendingUpdateMock,
    }
    render(<SessionHeader />)
    expect(screen.getByText('System prompt has changed —')).toBeDefined()
  })

  it('applies the dynamic context update for the scoped session', () => {
    storeState.panes = { s1: makePane('s1', { changed: true }), s2: makePane('s2') }
    render(
      <SessionScopeProvider value="s1">
        <SessionHeader />
      </SessionScopeProvider>,
    )
    fireEvent.click(screen.getByText('click here to update it'))
    fireEvent.click(screen.getByText('apply'))
    expect(sendMock).toHaveBeenCalledWith('context.applyDynamic', { sessionId: 's1' })
  })

  it('queues a scoped update while running and fires it when that session stops', () => {
    storeState.panes = { s1: makePane('s1', { changed: true, isRunning: true }), s2: makePane('s2') }
    storeState.queueUpdate = (sessionId: string) => {
      queueUpdateMock(sessionId)
      storeState.pendingUpdate = sessionId
    }
    const { rerender } = render(
      <SessionScopeProvider value="s1">
        <SessionHeader />
      </SessionScopeProvider>,
    )
    fireEvent.click(screen.getByText('click here to update it'))
    fireEvent.click(screen.getByText('apply'))
    expect(queueUpdateMock).toHaveBeenCalledWith('s1')
    storeState.panes = { s1: makePane('s1', { changed: true, isRunning: false }), s2: makePane('s2') }
    rerender(
      <SessionScopeProvider value="s1">
        <SessionHeader />
      </SessionScopeProvider>,
    )
    expect(triggerPendingUpdateMock).toHaveBeenCalled()
  })

  it('keeps a stable hook order when the session scope resolves after mount', () => {
    // Fresh-project scenario: the scoped session id is falsy on the first
    // render (session still loading) and pops in on the next. useSessionScope
    // must not call hooks conditionally on the provider value, or React
    // throws "change in the order of Hooks" / "Rendered fewer hooks".
    const { rerender } = render(
      <SessionScopeProvider value="">
        <SessionHeader />
      </SessionScopeProvider>,
    )
    rerender(
      <SessionScopeProvider value="s1">
        <SessionHeader />
      </SessionScopeProvider>,
    )
    expect(screen.queryByText('System prompt has changed —')).toBeNull()
  })
})
