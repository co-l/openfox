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

const mockAuthFetch = vi.fn()
vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>()
  return {
    ...actual,
    authFetch: mockAuthFetch,
  }
})

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

const layoutProps = vi.hoisted(() => ({
  sidebar: { isOpen: undefined as boolean | undefined, overlay: undefined as boolean | undefined },
  rightSidebar: { open: undefined as boolean | undefined, overlay: undefined as boolean | undefined },
  header: {
    onMenuClick: undefined as (() => void) | undefined,
    onCriteriaToggle: undefined as (() => void) | undefined,
  },
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

vi.mock('./hooks/useCurrentProject', () => ({
  useCurrentProject: () => ({ id: 'test-project', name: 'Test Project', workdir: '/test' }),
}))

const configStoreState = vi.hoisted(() => ({
  providers: [],
  activeProviderId: null,
  configFetched: true,
  fetchConfig: vi.fn(async () => {}),
  refreshProviderModels: vi.fn(async () => {}),
}))

vi.mock('./stores/config', () => ({
  useConfigStore: (selector?: any) => {
    return selector ? selector(configStoreState) : configStoreState
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
  Header: (props: { onMenuClick?: () => void; onCriteriaToggle?: () => void }) => {
    layoutProps.header.onMenuClick = props.onMenuClick
    layoutProps.header.onCriteriaToggle = props.onCriteriaToggle
    return <header data-testid="header">Header</header>
  },
}))

vi.mock('./components/layout/Sidebar', () => ({
  Sidebar: (props: { isOpen?: boolean; overlay?: boolean }) => {
    layoutProps.sidebar.isOpen = props.isOpen
    layoutProps.sidebar.overlay = props.overlay
    return <aside data-testid="sidebar">Sidebar</aside>
  },
}))

const noop = () => null
vi.mock('./components/HomePage', () => ({ HomePage: noop }))
vi.mock('./components/EmptyProjectView', () => ({ EmptyProjectView: noop }))
vi.mock('./components/plan/PlanPanel', () => ({
  PlanPanel: (props: { criteriaSidebarOpen?: boolean; criteriaSidebarOverlay?: boolean }) => {
    layoutProps.rightSidebar.open = props.criteriaSidebarOpen
    layoutProps.rightSidebar.overlay = props.criteriaSidebarOverlay
    return null
  },
}))
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

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

async function renderAppAt(width: number): Promise<HTMLElement> {
  setViewportWidth(width)
  localStorage.removeItem('openfox:leftSidebar')
  localStorage.removeItem('openfox:rightSidebar')
  return renderAppAsync()
}

beforeEach(() => {
  sessionState.connectionStatus = 'connected'
  sessionState.showPasswordModal = false
  sessionState.passwordModalRetry = false
  localStorage.removeItem('openfox_token')
  localStorage.removeItem('openfox:leftSidebar')
  localStorage.removeItem('openfox:rightSidebar')
  document.body.innerHTML = ''
  layoutProps.sidebar.isOpen = undefined
  layoutProps.sidebar.overlay = undefined
  layoutProps.rightSidebar.open = undefined
  layoutProps.rightSidebar.overlay = undefined
  layoutProps.header.onMenuClick = undefined
  layoutProps.header.onCriteriaToggle = undefined
  mockAuthFetch.mockReset()
  mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response)
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

  it('does not fetch per-key settings while unauthenticated (no pre-login 401 noise)', async () => {
    sessionState.connectionStatus = 'disconnected'
    sessionState.showPasswordModal = true
    localStorage.removeItem('openfox_token')

    await renderAppAsync()

    const settingsCalls = mockAuthFetch.mock.calls.filter((c) => String(c[0]).includes('/api/settings'))
    expect(settingsCalls).toHaveLength(0)
  })
})

describe('App - responsive sidebar visibility', () => {
  it('keeps both sidebars inline on a wide desktop window', async () => {
    await renderAppAt(1400)

    expect(layoutProps.sidebar.isOpen).toBe(true)
    expect(layoutProps.sidebar.overlay).toBe(false)
    expect(layoutProps.rightSidebar.open).toBe(true)
    expect(layoutProps.rightSidebar.overlay).toBe(false)
  })

  it('auto-collapses the left sidebar before the right one on a narrow desktop window', async () => {
    await renderAppAt(900)

    expect(layoutProps.sidebar.isOpen).toBe(false)
    expect(layoutProps.rightSidebar.open).toBe(true)
  })

  it('opens the left sidebar as an overlay on manual toggle when it cannot fit inline', async () => {
    await renderAppAt(900)
    expect(layoutProps.sidebar.isOpen).toBe(false)

    act(() => layoutProps.header.onMenuClick?.())

    expect(layoutProps.sidebar.isOpen).toBe(true)
    expect(layoutProps.sidebar.overlay).toBe(true)
  })

  it('drops the transient overlay flag once the sidebar can be inline again', async () => {
    await renderAppAt(900)
    act(() => layoutProps.header.onMenuClick?.())
    expect(layoutProps.sidebar.overlay).toBe(true)

    // Widen: the sidebar becomes inline and the transient overlay is cleared.
    act(() => {
      setViewportWidth(1400)
      window.dispatchEvent(new Event('resize'))
    })
    expect(layoutProps.sidebar.isOpen).toBe(true)
    expect(layoutProps.sidebar.overlay).toBe(false)

    // Narrow again: without the stale flag the sidebar stays collapsed.
    act(() => {
      setViewportWidth(900)
      window.dispatchEvent(new Event('resize'))
    })
    expect(layoutProps.sidebar.isOpen).toBe(false)
  })

  it('does not leak a desktop overlay into the mobile layout', async () => {
    await renderAppAt(900)
    act(() => layoutProps.header.onMenuClick?.())
    expect(layoutProps.sidebar.isOpen).toBe(true)

    act(() => {
      setViewportWidth(700)
      window.dispatchEvent(new Event('resize'))
    })
    expect(layoutProps.sidebar.isOpen).toBe(false)
  })

  it('treats sub-768 widths as mobile overlays, closed by default', async () => {
    await renderAppAt(700)

    expect(layoutProps.sidebar.isOpen).toBe(false)
    expect(layoutProps.sidebar.overlay).toBe(true)
    expect(layoutProps.rightSidebar.open).toBe(false)
    expect(layoutProps.rightSidebar.overlay).toBe(true)
  })
})
