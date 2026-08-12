// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { CurrentlyRunning } from './CurrentlyRunning'

const { enterSplitViewMock, openPaneMock, navigateMock } = vi.hoisted(() => ({
  enterSplitViewMock: vi.fn(async () => undefined),
  openPaneMock: vi.fn(async () => undefined),
  navigateMock: vi.fn(),
}))

let storeState: Record<string, unknown> = {}

vi.mock('../../stores/session', () => ({
  useSessionStore: Object.assign((selector: (state: unknown) => unknown) => selector(storeState), {
    getState: () => storeState,
  }),
}))

vi.mock('../../stores/project', () => ({
  useProjectStore: (selector: (state: unknown) => unknown) =>
    selector({
      projects: [
        { id: 'p1', name: 'acme-app' },
        { id: 'p2', name: 'blog' },
      ],
    }),
}))

vi.mock('wouter', () => ({
  useLocation: () => [undefined, navigateMock],
}))

function makeSession(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    projectId: 'p1',
    title: `Session ${id}`,
    phase: 'build',
    isRunning: true,
    isFavorite: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 3,
    ...overrides,
  }
}

describe('CurrentlyRunning', () => {
  beforeEach(() => {
    storeState = {
      sessions: [],
      sessionsWithPendingConfirmations: [],
      enterSplitView: enterSplitViewMock,
      openPane: openPaneMock,
    }
    enterSplitViewMock.mockClear()
    openPaneMock.mockClear()
    navigateMock.mockClear()
  })

  afterEach(() => cleanup())

  it('renders nothing when no session is running or waiting', () => {
    storeState.sessions = [makeSession('s1', { isRunning: false })]
    const { container } = render(<CurrentlyRunning />)
    expect(container.firstChild).toBeNull()
  })

  it('lists running sessions across projects', () => {
    storeState.sessions = [
      makeSession('s1', { projectId: 'p1', isRunning: true }),
      makeSession('s2', { projectId: 'p2', isRunning: true }),
    ]
    render(<CurrentlyRunning />)
    expect(screen.getByText('acme-app')).toBeDefined()
    expect(screen.getByText('blog')).toBeDefined()
    expect(screen.getByText('Session s1')).toBeDefined()
    expect(screen.getByText('Session s2')).toBeDefined()
  })

  it('includes sessions waiting on the user (pending confirmations)', () => {
    storeState.sessions = [makeSession('s1', { isRunning: false })]
    storeState.sessionsWithPendingConfirmations = ['s1']
    render(<CurrentlyRunning />)
    expect(screen.getByText('Session s1')).toBeDefined()
    expect(screen.getByText('Needs you')).toBeDefined()
  })

  it('hides the open-split button when one or fewer sessions qualify', () => {
    storeState.sessions = [makeSession('s1', { isRunning: true })]
    render(<CurrentlyRunning />)
    expect(screen.queryByText('Open split view')).toBeNull()
  })

  it('opens all eligible sessions in split view via the primary button', () => {
    storeState.sessions = [
      makeSession('s1', { projectId: 'p1', isRunning: true }),
      makeSession('s2', { projectId: 'p2', isRunning: true }),
    ]
    render(<CurrentlyRunning />)
    fireEvent.click(screen.getByText('Open split view'))
    expect(enterSplitViewMock).toHaveBeenCalledWith(['s1', 's2'], 's1')
    expect(navigateMock).toHaveBeenCalledWith('/split-view')
  })

  it('adds a single session to the split via the row action', () => {
    storeState.sessions = [makeSession('s1', { projectId: 'p1', isRunning: true })]
    render(<CurrentlyRunning />)
    const splitButtons = screen.getAllByText('Split')
    fireEvent.click(splitButtons[0]!)
    expect(openPaneMock).toHaveBeenCalledWith('s1', { focus: true })
    expect(navigateMock).toHaveBeenCalledWith('/split-view')
  })
})
