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
  return fn
}

vi.mock('../../stores/session', () => ({
  useSessionStore: mockStore({
    currentSession: null,
    sessions: [],
    messages: [],
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
})
