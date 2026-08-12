// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SplitView } from './SplitView'

const { focusPaneMock, closePaneMock, navigateMock, controlCollapsedMock, listHomeSessionsMock } = vi.hoisted(() => ({
  focusPaneMock: vi.fn(),
  closePaneMock: vi.fn(),
  navigateMock: vi.fn(),
  controlCollapsedMock: vi.fn(),
  listHomeSessionsMock: vi.fn(async () => undefined),
}))

let storeState: Record<string, unknown> = {}

vi.mock('../../stores/session', () => ({
  useSessionStore: Object.assign((selector: (state: unknown) => unknown) => selector(storeState), {
    getState: () => storeState,
  }),
}))

vi.mock('./SessionPane', () => ({
  SessionPane: ({ sessionId, focused, onFocus, onClose }: Record<string, unknown>) => (
    <div data-testid="pane" data-session={sessionId as string} data-focused={String(focused)}>
      <span>pane-{sessionId as string}</span>
      <button onClick={onFocus as () => void}>focus</button>
      <button onClick={onClose as () => void}>close</button>
    </div>
  ),
}))

vi.mock('./SplitControlPanel', () => ({
  SplitControlPanel: (props: { collapsed?: boolean }) => {
    controlCollapsedMock(props.collapsed)
    return <div data-testid="control-panel">panel</div>
  },
}))

vi.mock('wouter', () => ({
  useLocation: () => [undefined, navigateMock],
}))

const makePane = (id: string) => ({
  session: { id, projectId: 'p1', metadata: { title: `Title ${id}` } },
  messages: [],
  hiddenCount: 0,
  currentTodos: [],
  pendingPathConfirmations: [],
  pendingQuestions: [],
})

describe('SplitView', () => {
  beforeEach(() => {
    storeState = {
      openSessionIds: [],
      focusedSessionId: null,
      sessions: [],
      panes: {},
      focusPane: focusPaneMock,
      closePane: closePaneMock,
      listHomeSessions: listHomeSessionsMock,
    }
    focusPaneMock.mockClear()
    closePaneMock.mockClear()
    navigateMock.mockClear()
    controlCollapsedMock.mockClear()
    listHomeSessionsMock.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('renders the control column next to the panes', () => {
    storeState.openSessionIds = ['s1']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1') }
    render(<SplitView />)
    expect(screen.getByTestId('control-panel')).toBeDefined()
    expect(screen.getAllByTestId('pane')).toHaveLength(1)
  })

  it('shows an empty state instead of bouncing when landing with no panes', () => {
    render(<SplitView />)
    expect(navigateMock).not.toHaveBeenCalled()
    expect(screen.getByText(/pick a session on the left/)).toBeDefined()
  })

  it('stays in the split view with the empty state when the last pane is closed', () => {
    storeState.openSessionIds = ['s1']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1') }
    const { rerender } = render(<SplitView />)
    navigateMock.mockClear()
    storeState.openSessionIds = []
    rerender(<SplitView />)
    expect(navigateMock).not.toHaveBeenCalled()
    expect(screen.getByText(/pick a session on the left/)).toBeDefined()
  })

  it('renders one pane per open session with the focused one flagged', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1'), s2: makePane('s2') }
    render(<SplitView />)
    const panes = screen.getAllByTestId('pane')
    expect(panes).toHaveLength(2)
    expect(panes[0]!.getAttribute('data-session')).toBe('s1')
    expect(panes[0]!.getAttribute('data-focused')).toBe('true')
    expect(panes[1]!.getAttribute('data-focused')).toBe('false')
  })

  it('focuses a pane when clicked', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1'), s2: makePane('s2') }
    render(<SplitView />)
    const panes = screen.getAllByTestId('pane')
    fireEvent.click(panes[1]!.querySelector('button')!) // focus button of s2
    expect(focusPaneMock).toHaveBeenCalledWith('s2')
  })

  it('closes a pane via its close button', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1'), s2: makePane('s2') }
    render(<SplitView />)
    const panes = screen.getAllByTestId('pane')
    const buttons = panes[1]!.querySelectorAll('button')
    fireEvent.click(buttons[1]!) // close of s2
    expect(closePaneMock).toHaveBeenCalledWith('s2')
  })

  it('renders every open pane — no cap', () => {
    storeState.openSessionIds = ['s1', 's2', 's3', 's4', 's5']
    storeState.focusedSessionId = 's1'
    storeState.panes = {
      s1: makePane('s1'),
      s2: makePane('s2'),
      s3: makePane('s3'),
      s4: makePane('s4'),
      s5: makePane('s5'),
    }
    render(<SplitView />)
    expect(screen.getAllByTestId('pane')).toHaveLength(5)
  })

  it('forwards the header-driven control panel collapse state', () => {
    storeState.openSessionIds = ['s1']
    storeState.panes = { s1: makePane('s1') }
    render(<SplitView controlOpen={false} />)
    expect(controlCollapsedMock).toHaveBeenCalledWith(true)
  })

  it('refreshes the session list on mount, on an interval and when the tab refocuses', () => {
    vi.useFakeTimers()
    storeState.openSessionIds = ['s1']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1') }
    render(<SplitView />)

    // Immediate refresh on mount
    expect(listHomeSessionsMock).toHaveBeenCalledTimes(1)

    // Periodic refresh while the route stays mounted
    vi.advanceTimersByTime(20_000)
    expect(listHomeSessionsMock).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(20_000)
    expect(listHomeSessionsMock).toHaveBeenCalledTimes(3)

    // Refocusing the tab triggers an immediate refresh
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(listHomeSessionsMock).toHaveBeenCalledTimes(4)
  })
})
