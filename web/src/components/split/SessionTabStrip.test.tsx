// @vitest-environment happy-dom
import { useState } from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SessionTabStrip } from './SessionTabStrip'

const { focusPaneMock, closePaneMock } = vi.hoisted(() => ({
  focusPaneMock: vi.fn(),
  closePaneMock: vi.fn(),
}))

let storeState: Record<string, unknown> = {}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector(storeState),
}))

const makePane = (
  id: string,
  overrides: { isRunning?: boolean; questions?: number; confirmations?: number; title?: string } = {},
) => ({
  session: {
    id,
    projectId: 'p1',
    isRunning: overrides.isRunning ?? false,
    metadata: { title: overrides.title ?? `Title ${id}` },
  },
  messages: [],
  hiddenCount: 0,
  currentTodos: [],
  pendingPathConfirmations: new Array(overrides.confirmations ?? 0).fill({}),
  pendingQuestions: new Array(overrides.questions ?? 0).fill({}),
})

describe('SessionTabStrip', () => {
  beforeEach(() => {
    storeState = {
      openSessionIds: [],
      focusedSessionId: null,
      panes: {},
      focusPane: focusPaneMock,
      closePane: closePaneMock,
    }
    focusPaneMock.mockClear()
    closePaneMock.mockClear()
  })

  afterEach(cleanup)

  it('renders one tab per open session', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1'), s2: makePane('s2') }
    render(<SessionTabStrip />)
    expect(screen.getAllByTestId('session-tab')).toHaveLength(2)
  })

  it('flags the focused session and shows its title', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's2'
    storeState.panes = { s1: makePane('s1'), s2: makePane('s2', { title: 'Refactor API' }) }
    render(<SessionTabStrip />)
    const tabs = screen.getAllByTestId('session-tab')
    expect(tabs[0]!.getAttribute('data-focused')).toBe('false')
    expect(tabs[1]!.getAttribute('data-focused')).toBe('true')
    expect(screen.getByText('Refactor API')).toBeDefined()
  })

  it('marks running sessions so they stay visible while unfocused', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1', { isRunning: true }), s2: makePane('s2') }
    render(<SessionTabStrip />)
    const running = screen.getAllByTestId('session-tab-running')
    expect(running).toHaveLength(1)
    expect(running[0]!.closest('[data-testid="session-tab"]')!.getAttribute('data-session')).toBe('s1')
  })

  it('badges pending questions and confirmations on unfocused tabs', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1'), s2: makePane('s2', { questions: 2, confirmations: 1 }) }
    render(<SessionTabStrip />)
    const badges = screen.getAllByTestId('session-tab-attention')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.textContent).toContain('2')
    expect(badges[0]!.textContent).toContain('1')
  })

  it('focuses a pane when its tab is tapped', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1'), s2: makePane('s2') }
    render(<SessionTabStrip />)
    fireEvent.click(screen.getAllByRole('tab')[1]!)
    expect(focusPaneMock).toHaveBeenCalledWith('s2')
  })

  it('traverses tabs with the arrow keys, moving DOM focus as it goes', () => {
    // A re-rendering store, so focusPane actually changes the focused tab and
    // the handler resolves from the newly focused one.
    function Harness() {
      const [focused, setFocused] = useState('s1')
      storeState = {
        ...storeState,
        focusedSessionId: focused,
        focusPane: (id: string) => {
          focusPaneMock(id)
          setFocused(id)
        },
      }
      return <SessionTabStrip />
    }
    storeState.openSessionIds = ['s1', 's2', 's3']
    storeState.panes = { s1: makePane('s1'), s2: makePane('s2'), s3: makePane('s3') }
    render(<Harness />)

    screen.getAllByRole('tab')[0]!.focus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })

    expect(focusPaneMock.mock.calls).toEqual([['s2'], ['s3']])
    expect(document.activeElement).toBe(screen.getAllByRole('tab')[2])
  })

  it('exposes tabs as real buttons with a roving tabindex', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1'), s2: makePane('s2') }
    render(<SessionTabStrip />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]!.tagName).toBe('BUTTON')
    expect(tabs[0]!.getAttribute('tabindex')).toBe('0')
    expect(tabs[1]!.getAttribute('tabindex')).toBe('-1')
  })

  it('closes only the targeted pane and does not also focus it', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1'), s2: makePane('s2') }
    render(<SessionTabStrip />)
    const activeTab = screen.getAllByTestId('session-tab').find((t) => t.getAttribute('data-focused') === 'true')!
    fireEvent.click(activeTab.querySelector('[data-testid="session-tab-close"]')!)
    expect(closePaneMock).toHaveBeenCalledTimes(1)
    expect(closePaneMock).toHaveBeenCalledWith('s1')
    expect(focusPaneMock).not.toHaveBeenCalled()
  })

  it('has no close button on unfocused tabs', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: makePane('s1'), s2: makePane('s2') }
    render(<SessionTabStrip />)
    const inactive = screen.getAllByTestId('session-tab').find((t) => t.getAttribute('data-focused') === 'false')!
    expect(inactive.querySelector('[data-testid="session-tab-close"]')).toBeNull()
  })
})
