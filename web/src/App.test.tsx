// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// Mock ws module to avoid window reference
vi.mock('./lib/ws', () => ({
  wsClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    subscribe: vi.fn(),
    onStatusChange: vi.fn(),
    hasToken: () => false,
    setToken: vi.fn(),
    clearToken: vi.fn(),
    getLastCloseCode: () => 0,
  },
}))

const mockNavigate = vi.fn()
vi.mock('wouter', () => ({
  Route: ({ children, path }: { children: React.ReactNode; path: string }) => <div data-path={path}>{children}</div>,
  Switch: ({ children }: { children: React.ReactNode }) => <div data-switch>{children}</div>,
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useRoute: (path: string) => {
    if (path === '/p/:projectId/s/:sessionId/readonly') {
      return [false, {}]
    }
    if (path === '/p/:projectId/s/:sessionId') {
      return [true, { projectId: 'test-project', sessionId: 'deleted-session' }]
    }
    if (path === '/p/:projectId') {
      return [true, { projectId: 'test-project' }]
    }
    return [false, {}]
  },
  useLocation: () => [undefined, mockNavigate],
}))

const sessionState = vi.hoisted(() => ({
  connectionStatus: 'connected' as 'connected' | 'disconnected' | 'reconnecting',
  showPasswordModal: false,
  passwordModalRetry: false,
}))

vi.mock('./hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    connectionStatus: sessionState.connectionStatus,
  }),
}))

vi.mock('./stores/session', () => ({
  useSessionStore: (selector?: any) => {
    const state = {
      connectionStatus: sessionState.connectionStatus,
      showPasswordModal: sessionState.showPasswordModal,
      passwordModalRetry: sessionState.passwordModalRetry,
      sessions: [],
      currentSession: { id: 'deleted-session', projectId: 'test-project' },
      messages: [],
      currentTodos: [],
      contextState: null,
      pendingPathConfirmation: null,
      error: { code: 'NOT_FOUND', message: 'Session not found' },
      loadSession: vi.fn(),
      listSessions: vi.fn(),
      clearError: vi.fn(),
      submitPassword: vi.fn(),
      cancelPassword: vi.fn(),
      openSessionIds: [],
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('./stores/project', () => ({
  useProjectStore: (selector?: any) => {
    const state = {
      currentProject: { id: 'test-project', name: 'Test Project', workdir: '/test' },
      loadProject: vi.fn(),
      handleServerMessage: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('./stores/config', () => ({
  useConfigStore: (selector?: any) => {
    const state = {
      providers: [],
      activeProviderId: null,
      configFetched: true,
      fetchConfig: vi.fn(),
      refreshProviderModels: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('./stores/mcp', () => ({
  useMcpStore: (selector?: any) => {
    return selector ? selector({}) : {}
  },
}))

const themeStoreState = vi.hoisted(() => ({
  loadUserPresets: vi.fn(),
  applySavedTheme: vi.fn(),
  applyPreset: vi.fn(),
  applyTokens: vi.fn(),
  setFollowSystemTheme: vi.fn(),
  initSystemThemeListener: () => () => {},
  basePreset: 'system',
  currentPreset: 'system',
  followSystemTheme: false,
  getSavedTheme: () => null,
}))

vi.mock('./stores/theme', () => ({
  useThemeStore: Object.assign(
    (selector?: any) => {
      return selector ? selector(themeStoreState) : themeStoreState
    },
    {
      getState: () => themeStoreState,
      setState: vi.fn(),
    },
  ),
}))

vi.mock('./stores/settings', () => ({
  SETTINGS_KEYS: {},
  DISPLAY_SETTINGS_KEYS: {},
  useSettingsStore: Object.assign(
    (selector?: any) => {
      const state = {
        settings: {},
        fetchDisplaySettings: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        settings: {},
      }),
      setState: vi.fn(),
    },
  ),
}))

vi.mock('./hooks/useProjectLoader', () => ({
  useProjectLoader: () => {},
}))

vi.mock('./hooks/useSessionLoader', () => ({
  useSessionLoader: () => {},
}))

vi.mock('./hooks/useVisualViewport', () => ({
  useVisualViewport: () => ({ offsetTop: 0, height: 800 }),
}))

vi.mock('./components/layout/Header', () => ({
  Header: () => <header data-testid="header">Header</header>,
}))

vi.mock('./components/layout/Sidebar', () => ({
  Sidebar: ({ projectId }: { projectId: string }) => <aside data-project-id={projectId}>Sidebar</aside>,
}))

const noop = () => null
vi.mock('./components/HomePage', () => ({ HomePage: noop }))
vi.mock('./components/EmptyProjectView', () => ({ EmptyProjectView: noop }))
vi.mock('./components/plan/PlanPanel', () => ({ PlanPanel: noop }))
vi.mock('./components/plan/ReadonlySessionView', () => ({ ReadonlySessionView: noop }))
vi.mock('./components/shared/CrossSessionConfirmationBanner', () => ({ CrossSessionConfirmationBanner: noop }))
vi.mock('./components/UpdateBanner', () => ({ UpdateBanner: noop }))
vi.mock('./components/ChangelogModal', () => ({ ChangelogModal: noop }))
vi.mock('./components/NewSessionHandler', () => ({ NewSessionHandler: noop }))
vi.mock('./components/shared/ScrollArea', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('./components/onboarding/OnboardingWizard', () => ({ OnboardingWizard: noop }))
vi.mock('./components/layout/PageTitle', () => ({ PageTitle: noop }))

vi.mock('./components/shared/Spinner', () => ({
  Spinner: () => <div>Spinner</div>,
  SpinnerWithText: ({ text }: { text: string }) => <div>{text}</div>,
}))

vi.mock('./components/PasswordModal', () => ({
  PasswordModal: ({ isOpen, isRetry }: { isOpen: boolean; isRetry?: boolean }) =>
    isOpen ? <div data-testid="password-modal">{isRetry ? 'Invalid Password' : 'Password Required'}</div> : null,
}))

async function renderAppAsync(): Promise<HTMLElement> {
  const App = (await import('./App')).default
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<App />)
  })
  return container
}

beforeEach(() => {
  sessionState.connectionStatus = 'connected'
  sessionState.showPasswordModal = false
  sessionState.passwordModalRetry = false
  localStorage.removeItem('openfox_token')
  document.body.innerHTML = ''
})

describe('App - imports', () => {
  it('imports without throwing', async () => {
    const App = (await import('./App')).default
    expect(App).toBeDefined()
  })
})

describe('App - Password modal rendering', () => {
  it('does not render PasswordModal during reconnect when no token and server does not require auth', async () => {
    sessionState.connectionStatus = 'reconnecting'
    sessionState.showPasswordModal = false
    localStorage.removeItem('openfox_token')

    const container = await renderAppAsync()

    expect(container.textContent).toContain('Connecting to server...')
    expect(container.textContent).not.toContain('Password Required')
    expect(container.querySelector('[data-testid="password-modal"]')).toBeNull()
  })

  it('renders PasswordModal via showPasswordModal state after /api/auth confirms auth required', async () => {
    sessionState.connectionStatus = 'reconnecting'
    sessionState.showPasswordModal = true
    localStorage.removeItem('openfox_token')

    const container = await renderAppAsync()

    expect(container.querySelector('[data-testid="password-modal"]')).not.toBeNull()
    expect(container.textContent).toContain('Password Required')
  })
})
