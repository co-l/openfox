// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('../../lib/ws', () => ({
  wsClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    subscribe: vi.fn(),
    onStatusChange: vi.fn(),
  },
}))

vi.mock('wouter', () => ({
  Link: ({ children, href, className }: any) => `<a href="${href}" class="${className}">${children}</a>`,
  useLocation: vi.fn(() => ['/', vi.fn()]),
  useSearch: () => '',
}))

interface MockStore {
  (selector?: (state: any) => any): any
  setState: (partial: Record<string, any>) => void
}

function mockStore(initial: Record<string, any>): MockStore {
  let state = { ...initial }
  const fn = vi.fn((selector?: (s: typeof state) => any) => {
    return selector ? selector(state) : state
  }) as unknown as MockStore
  fn.setState = (partial: Record<string, any>) => {
    state = { ...state, ...partial }
  }
  ;(fn as unknown as { getState: () => Record<string, any> }).getState = () => state
  return fn
}

vi.mock('../../stores/session', () => ({
  useSessionStore: mockStore({
    currentSession: null,
    sessions: [],
    messages: [],
    openSessionIds: [],
    focusedSessionId: null,
    agentMode: 'planner',
    planMode: false,
    status: 'idle',
    projectId: null,
    loadSession: vi.fn(),
    createSession: vi.fn(),
    listSessions: vi.fn(),
    deleteSession: vi.fn(),
    clearSession: vi.fn(),
    sendMessage: vi.fn(),
    stopGeneration: vi.fn(),
    continueGeneration: vi.fn(),
    launchWorkflow: vi.fn(),
    switchMode: vi.fn(),
    editCriteria: vi.fn(),
    compactContext: vi.fn(),
    setSessionProvider: vi.fn(),
    confirmPath: vi.fn(),
    queueAsap: vi.fn(),
    queueCompletion: vi.fn(),
    cancelQueued: vi.fn(),
    clearError: vi.fn(),
    handleServerMessage: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connectionStatus: 'connected',
    unreadSessionIds: [],
    currentTodos: [],
    contextState: null,
    pendingPathConfirmation: null,
    queuedMessages: [],
    abortInProgress: false,
    error: null,
    pendingSessionCreate: false,
    openPane: vi.fn(async () => undefined),
    exitSplitView: vi.fn(),
  }),
}))

vi.mock('../../stores/project', () => ({
  useProjectStore: mockStore({
    currentProject: null,
    projects: [],
    loading: false,
    loadProject: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    clearProject: vi.fn(),
    listProjects: vi.fn(),
    handleServerMessage: vi.fn(),
    toggleStar: vi.fn(),
  }),
}))

vi.mock('../../stores/config', () => ({
  useConfigStore: mockStore({
    config: { theme: 'dark', llmProvider: 'ollama', model: 'test' },
    startAutoRefresh: vi.fn(),
    stopAutoRefresh: vi.fn(),
  }),
}))

vi.mock('../../stores/terminal', () => ({
  useTerminalStore: mockStore({
    isOpen: false,
    sessions: [],
    workdir: null,
    setOpen: vi.fn(),
    toggleOpen: vi.fn(),
    setWorkdir: vi.fn(),
    executeCommand: vi.fn(),
  }),
}))

vi.mock('../../hooks/useKeybindings', () => ({
  useKeybindings: vi.fn(() => ({ terminalToggle: { key: 'Control', ctrlKey: true, code: 'ControlLeft' } })),
  useBinding: vi.fn(),
}))

vi.mock('../../hooks/useWorkdir', () => ({
  useWorkdir: vi.fn(() => '/tmp'),
}))

function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return container
}

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('renders the OpenFox logo link', async () => {
    const { Header } = await import('./Header')
    const container = render(<Header />)
    expect(container.textContent).toContain('OpenFox')
  })

  it('renders settings button', async () => {
    const { Header } = await import('./Header')
    const container = render(<Header />)
    const btn = container.querySelector('[title="Settings"]')
    expect(btn).toBeTruthy()
  })

  it('renders logout button', async () => {
    const { Header } = await import('./Header')
    const container = render(<Header />)
    const btn = container.querySelector('[title="Logout"]')
    expect(btn).toBeTruthy()
  })

  it('shows project name when project exists', async () => {
    const { useProjectStore } = await import('../../stores/project')
    ;(useProjectStore as unknown as MockStore).setState({
      currentProject: { id: 'p1', name: 'My Project', workdir: '/tmp' },
      projects: [{ id: 'p1', name: 'My Project', workdir: '/tmp' }],
    })

    const { useLocation } = await import('wouter')
    vi.mocked(useLocation).mockReturnValue(['/p/p1/', vi.fn()])

    const { Header } = await import('./Header')
    const container = render(<Header />)
    expect(container.textContent).toContain('My Project')
  })

  it('shows terminal toggle on project page', async () => {
    const { useProjectStore } = await import('../../stores/project')
    ;(useProjectStore as unknown as MockStore).setState({
      currentProject: { id: 'p1', name: 'P', workdir: '/tmp' },
      projects: [{ id: 'p1', name: 'P', workdir: '/tmp' }],
    })

    const { useLocation } = await import('wouter')
    vi.mocked(useLocation).mockReturnValue(['/p/p1/', vi.fn()])

    const { Header } = await import('./Header')
    const container = render(<Header />)
    const btn = container.querySelector('[title^="Toggle terminal"]')
    expect(btn).toBeTruthy()
  })

  it('shows menu button when onMenuClick provided and on session page', async () => {
    const { useProjectStore } = await import('../../stores/project')
    ;(useProjectStore as unknown as MockStore).setState({
      currentProject: { id: 'p1', name: 'P', workdir: '/tmp' },
      projects: [{ id: 'p1', name: 'P', workdir: '/tmp' }],
    })

    const { useLocation } = await import('wouter')
    vi.mocked(useLocation).mockReturnValue(['/p/p1/s/s1', vi.fn()])

    const { Header } = await import('./Header')
    const container = render(<Header onMenuClick={vi.fn()} />)
    const btn = container.querySelector('[title^="Toggle session list"]')
    expect(btn).toBeTruthy()
  })

  it('hides menu button when not on session page', async () => {
    const { useProjectStore } = await import('../../stores/project')
    ;(useProjectStore as unknown as MockStore).setState({
      currentProject: { id: 'p1', name: 'P', workdir: '/tmp' },
      projects: [{ id: 'p1', name: 'P', workdir: '/tmp' }],
    })

    const { useLocation } = await import('wouter')
    vi.mocked(useLocation).mockReturnValue(['/p/p1/', vi.fn()])

    const { Header } = await import('./Header')
    const container = render(<Header onMenuClick={vi.fn()} />)
    const btn = container.querySelector('[title^="Toggle session list"]')
    expect(btn).toBeNull()
  })

  it('truncates long session name in header dropdown trigger', async () => {
    const { useProjectStore } = await import('../../stores/project')
    ;(useProjectStore as unknown as MockStore).setState({
      currentProject: { id: 'p1', name: 'Test Project', workdir: '/tmp' },
      projects: [{ id: 'p1', name: 'Test Project', workdir: '/tmp' }],
    })

    const { useSessionStore } = await import('../../stores/session')
    const longTitle = 'a'.repeat(100)
    ;(useSessionStore as unknown as MockStore).setState({
      currentSession: { id: 's1', metadata: { title: longTitle } },
      sessions: [{ id: 's1', projectId: 'p1', title: longTitle, updatedAt: new Date().toISOString() }],
    })

    const { useLocation } = await import('wouter')
    vi.mocked(useLocation).mockReturnValue(['/p/p1/s/s1', vi.fn()])

    const { Header } = await import('./Header')
    const container = render(<Header />)
    const btn = container.querySelector('[data-testid="header-session-dropdown"]')
    expect(btn).toBeTruthy()
    // Button text should be truncated (50 chars + '...')
    expect(btn!.textContent).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...')
    // Title attribute should still contain the full name
    expect(btn!.getAttribute('title')).toBe(longTitle)
  })

  it('shows only the running task count in the green badge', async () => {
    const { useProjectStore } = await import('../../stores/project')
    ;(useProjectStore as unknown as MockStore).setState({
      currentProject: { id: 'p1', name: 'P', workdir: '/tmp' },
      projects: [{ id: 'p1', name: 'P', workdir: '/tmp' }],
    })

    const { useTasksStore } = await import('../../stores/tasks')
    useTasksStore.setState({
      counts: {
        open: 5,
        todo: 3,
        inProgress: 2,
        running: 2,
        queued: 0,
        done: 0,
      },
    })

    const { useLocation } = await import('wouter')
    vi.mocked(useLocation).mockReturnValue(['/p/p1/', vi.fn()])

    const { Header } = await import('./Header')
    const container = render(<Header />)
    const badge = container.querySelector('[aria-label="Open project tasks"] span')
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toBe('2')
    expect(badge!.className).toContain('bg-accent-success')
  })

  it('hides the task badge when no tasks are running', async () => {
    const { useProjectStore } = await import('../../stores/project')
    ;(useProjectStore as unknown as MockStore).setState({
      currentProject: { id: 'p1', name: 'P', workdir: '/tmp' },
      projects: [{ id: 'p1', name: 'P', workdir: '/tmp' }],
    })

    const { useTasksStore } = await import('../../stores/tasks')
    useTasksStore.setState({
      counts: {
        open: 5,
        todo: 3,
        inProgress: 2,
        running: 0,
        queued: 2,
        done: 0,
      },
    })

    const { useLocation } = await import('wouter')
    vi.mocked(useLocation).mockReturnValue(['/p/p1/', vi.fn()])

    const { Header } = await import('./Header')
    const container = render(<Header />)
    expect(container.querySelector('[aria-label="Open project tasks"] span')).toBeNull()
  })

  it('shows the control panel toggle on the split-view route', async () => {
    const { useLocation } = await import('wouter')
    vi.mocked(useLocation).mockReturnValue(['/split-view', vi.fn()])

    const { Header } = await import('./Header')
    const container = render(<Header onMenuClick={vi.fn()} />)
    expect(container.querySelector('[aria-label="Toggle split view control panel"]')).toBeTruthy()
  })

  it('opens split view and adds the current session as a pane', async () => {
    const { useSessionStore } = await import('../../stores/session')
    ;(useSessionStore as unknown as MockStore).setState({
      currentSession: { id: 's1', metadata: { title: 'T' } },
    })

    const { useLocation } = await import('wouter')
    const setLocation = vi.fn()
    vi.mocked(useLocation).mockReturnValue(['/p/p1/s/s1', setLocation])

    const { Header } = await import('./Header')
    const container = render(<Header />)
    const btn = container.querySelector('[aria-label="Open split view"]')
    expect(btn).toBeTruthy()
    act(() => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(setLocation).toHaveBeenCalledWith('/split-view')
    const { openPane } = useSessionStore.getState()
    expect(openPane).toHaveBeenCalledWith('s1', { focus: true })
  })

  it('shows the split indicator and exits back home from the split route', async () => {
    const { useSessionStore } = await import('../../stores/session')
    ;(useSessionStore as unknown as MockStore).setState({ openSessionIds: ['s1', 's2'] })

    const { useLocation } = await import('wouter')
    const setLocation = vi.fn()
    vi.mocked(useLocation).mockReturnValue(['/split-view', setLocation])

    const { Header } = await import('./Header')
    const container = render(<Header />)
    expect(container.querySelector('[data-testid="split-indicator"]')?.textContent).toContain('2')

    const exitBtn = container.querySelector('[aria-label="Exit split view"]')
    expect(exitBtn).toBeTruthy()
    act(() => {
      exitBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(setLocation).toHaveBeenCalledWith('/')
    const { exitSplitView } = useSessionStore.getState()
    expect(exitSplitView).toHaveBeenCalledTimes(1)
  })
})
