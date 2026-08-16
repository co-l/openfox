// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { Sidebar } from './Sidebar'
import { useDevServerStore } from '../../stores/dev-server'

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

vi.mock('wouter', () => ({
  useLocation: () => [undefined, vi.fn()],
  Link: ({ children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}))

interface SessionFixture {
  id: string
  projectId: string
  workdir: string
  workspace?: string
  title?: string
  isRunning: boolean
  isFavorite: boolean
  mode: 'planner'
  phase: 'plan' | 'build'
  createdAt: string
  updatedAt: string
  criteriaCount: number
  criteriaCompleted: number
  messageCount: number
}

const baseSessions: SessionFixture[] = [
  {
    id: 'session-running',
    projectId: 'project-1',
    workdir: '/tmp/running',
    title: 'Running workdir',
    isRunning: false,
    isFavorite: false,
    mode: 'planner',
    phase: 'build',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 0,
  },
  {
    id: 'session-warning',
    projectId: 'project-1',
    workdir: '/tmp/warning',
    title: 'Warning workdir',
    isRunning: false,
    isFavorite: false,
    mode: 'planner',
    phase: 'plan',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 0,
  },
  {
    id: 'session-off',
    projectId: 'project-1',
    workdir: '/tmp/off',
    title: 'Off workdir',
    isRunning: false,
    isFavorite: false,
    mode: 'planner',
    phase: 'plan',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 0,
  },
  {
    id: 'session-shared',
    projectId: 'project-1',
    workdir: '/tmp/shared',
    title: 'Shared workdir alpha',
    isRunning: false,
    isFavorite: false,
    mode: 'planner',
    phase: 'plan',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 0,
  },
  {
    id: 'session-shared-2',
    projectId: 'project-1',
    workdir: '/tmp/shared',
    workspace: '/tmp/shared',
    title: 'Shared workdir beta',
    isRunning: false,
    isFavorite: false,
    mode: 'planner',
    phase: 'plan',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 0,
  },
]

const sessionStoreStateRef: { current: Record<string, unknown> } = {
  current: {
    sessions: baseSessions,
    currentSession: null,
    unreadSessionIds: [],
    sessionsWithPendingConfirmations: [],
    pendingPathConfirmations: [],
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    listSessions: vi.fn(),
    loadMoreSessions: vi.fn(),
    sessionsHasMore: false,
    sessionsPaginationLoading: false,
    toggleFavorite: vi.fn(),
  },
}

const projectStoreState = {
  currentProject: { id: 'project-1', name: 'Project', workdir: '/tmp/project' },
}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: Record<string, unknown>) => unknown) => selector(sessionStoreStateRef.current),
}))

vi.mock('../../stores/project', () => ({
  useProjectStore: (selector: (state: typeof projectStoreState) => unknown) => selector(projectStoreState),
}))

vi.mock('../shared/Button', () => ({
  Button: ({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) => (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('../settings/ProjectSettingsModal', () => ({
  ProjectSettingsModal: () => null,
}))

const renderSidebar = async (): Promise<HTMLDivElement> => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<Sidebar projectId="project-1" />)
  })
  await act(async () => {
    await Promise.resolve()
  })
  return Object.assign(container, { _root: root }) as HTMLDivElement & { _root: ReturnType<typeof createRoot> }
}

const cleanupSidebar = (container: HTMLDivElement & { _root?: ReturnType<typeof createRoot> }) => {
  container._root?.unmount()
  container.remove()
}

const setByWorkdir = (byWorkdir: Record<string, unknown>) => {
  useDevServerStore.setState({ byWorkdir } as never)
}

beforeEach(() => {
  sessionStoreStateRef.current = {
    ...sessionStoreStateRef.current,
    sessions: baseSessions,
  }
  setByWorkdir({})
  useDevServerStore.setState((state) => ({ ...state, fetchStatus: vi.fn() }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Sidebar dev-server indicator', () => {
  it('shows no indicator when no dev-server status is known', async () => {
    const container = await renderSidebar()
    expect(container.querySelectorAll('[data-testid="sidebar-devserver-indicator"]')).toHaveLength(0)
    cleanupSidebar(container)
  })

  it('renders a green running indicator and hides off sessions', async () => {
    setByWorkdir({
      '/tmp/running': {
        status: {
          state: 'running',
          url: null,
          hotReload: false,
          config: null,
          errorMessage: undefined,
          inspectProxyPort: null,
        },
        logs: [],
        config: null,
      },
      '/tmp/off': {
        status: {
          state: 'off',
          url: null,
          hotReload: false,
          config: null,
          errorMessage: undefined,
          inspectProxyPort: null,
        },
        logs: [],
        config: null,
      },
    })
    const container = await renderSidebar()
    const indicators = Array.from(container.querySelectorAll('[data-testid="sidebar-devserver-indicator"]'))
    expect(indicators).toHaveLength(1)
    const node = indicators[0] as HTMLElement
    expect(node.getAttribute('data-state')).toBe('running')
    expect(node.getAttribute('title')).toBe('Dev server running')
    expect(node.className).toContain('text-accent-success')
    cleanupSidebar(container)
  })

  it('distinguishes warning state visually from running', async () => {
    setByWorkdir({
      '/tmp/warning': {
        status: {
          state: 'warning',
          url: null,
          hotReload: false,
          config: null,
          errorMessage: 'boom',
          inspectProxyPort: null,
        },
        logs: [],
        config: null,
      },
    })
    const container = await renderSidebar()
    const indicators = Array.from(container.querySelectorAll('[data-testid="sidebar-devserver-indicator"]'))
    expect(indicators).toHaveLength(1)
    const node = indicators[0] as HTMLElement
    expect(node.getAttribute('data-state')).toBe('warning')
    expect(node.getAttribute('title')).toBe('Dev server warning: boom')
    expect(node.className).toContain('text-accent-warning')
    expect(node.className).not.toContain('text-accent-success')
    cleanupSidebar(container)
  })

  it('renders the error state in red and surfaces the error message', async () => {
    setByWorkdir({
      '/tmp/running': {
        status: {
          state: 'error',
          url: null,
          hotReload: false,
          config: null,
          errorMessage: 'build failed',
          inspectProxyPort: null,
        },
        logs: [],
        config: null,
      },
    })
    const container = await renderSidebar()
    const indicators = Array.from(container.querySelectorAll('[data-testid="sidebar-devserver-indicator"]'))
    expect(indicators).toHaveLength(1)
    const node = indicators[0] as HTMLElement
    expect(node.getAttribute('data-state')).toBe('error')
    expect(node.getAttribute('title')).toBe('Dev server error: build failed')
    expect(node.className).toContain('text-accent-error')
    cleanupSidebar(container)
  })

  it('includes the dev-server URL in the running tooltip', async () => {
    setByWorkdir({
      '/tmp/running': {
        status: {
          state: 'running',
          url: 'http://localhost:5173',
          hotReload: false,
          config: null,
          errorMessage: undefined,
          inspectProxyPort: null,
        },
        logs: [],
        config: null,
      },
    })
    const container = await renderSidebar()
    const indicators = Array.from(container.querySelectorAll('[data-testid="sidebar-devserver-indicator"]'))
    const node = indicators[0] as HTMLElement
    expect(node.getAttribute('title')).toBe('Dev server running at http://localhost:5173')
    cleanupSidebar(container)
  })

  it('renders the indicator for every session that shares the same workdir', async () => {
    setByWorkdir({
      '/tmp/shared': {
        status: {
          state: 'running',
          url: null,
          hotReload: false,
          config: null,
          errorMessage: undefined,
          inspectProxyPort: null,
        },
        logs: [],
        config: null,
      },
    })
    const container = await renderSidebar()
    expect(container.querySelectorAll('[data-testid="sidebar-devserver-indicator"]')).toHaveLength(2)
    cleanupSidebar(container)
  })

  it('reflects devServer.state updates without a page reload', async () => {
    const container = await renderSidebar()
    expect(container.querySelectorAll('[data-testid="sidebar-devserver-indicator"]')).toHaveLength(0)

    await act(async () => {
      useDevServerStore.getState().handleMessage({
        type: 'devServer.state',
        payload: { workdir: '/tmp/running', state: 'running', errorMessage: undefined },
      })
    })
    expect(container.querySelectorAll('[data-testid="sidebar-devserver-indicator"]')).toHaveLength(1)

    await act(async () => {
      useDevServerStore.getState().handleMessage({
        type: 'devServer.state',
        payload: { workdir: '/tmp/running', state: 'warning', errorMessage: 'oops' },
      })
    })
    const indicators = Array.from(container.querySelectorAll('[data-testid="sidebar-devserver-indicator"]'))
    expect(indicators).toHaveLength(1)
    expect((indicators[0] as HTMLElement).getAttribute('data-state')).toBe('warning')

    await act(async () => {
      useDevServerStore.getState().handleMessage({
        type: 'devServer.state',
        payload: { workdir: '/tmp/running', state: 'off', errorMessage: undefined },
      })
    })
    expect(container.querySelectorAll('[data-testid="sidebar-devserver-indicator"]')).toHaveLength(0)

    cleanupSidebar(container)
  })

  it('fetches dev-server status once per unique workdir on mount', async () => {
    const authFetch = (await import('../../lib/api')).authFetch as unknown as ReturnType<typeof vi.fn>
    authFetch.mockClear()

    const fetchStatusSpy = vi.fn()
    const originalFetchStatus = useDevServerStore.getState().fetchStatus
    useDevServerStore.setState((state) => ({ ...state, fetchStatus: fetchStatusSpy }))

    const container = await renderSidebar()
    await act(async () => {
      await Promise.resolve()
    })
    const calledWorkdirs = fetchStatusSpy.mock.calls.map((call) => call[0]).sort()
    expect(calledWorkdirs).toEqual(['/tmp/off', '/tmp/running', '/tmp/shared', '/tmp/warning'])

    useDevServerStore.setState((state) => ({ ...state, fetchStatus: originalFetchStatus }))
    cleanupSidebar(container)
  })
})
