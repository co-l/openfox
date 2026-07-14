// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

vi.mock('../lib/ws', () => ({
  wsClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    subscribe: vi.fn(),
    onStatusChange: vi.fn(),
  },
}))

vi.mock('wouter', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useLocation: () => [undefined, vi.fn()],
}))

const sessionStore = { sessions: [] as any[] }
vi.mock('../stores/session', () => ({
  useSessionStore: (selector?: any) => {
    const state = {
      sessions: sessionStore.sessions,
      listSessions: vi.fn(),
      connectionStatus: 'connected',
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../stores/project', () => ({
  useProjectStore: (selector?: any) => {
    const state = {
      projects: [
        {
          id: 'p1',
          name: 'Project Alpha',
          workdir: '/tmp/alpha',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
        {
          id: 'p2',
          name: 'Project Beta',
          workdir: '/tmp/beta',
          createdAt: '2024-01-02',
          updatedAt: '2024-01-02',
        },
      ],
      loading: false,
      listProjects: vi.fn(),
      deleteProject: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

beforeEach(() => {
  sessionStore.sessions = []
})

afterEach(() => {
  cleanup()
})

describe('HomePage', () => {
  it('exports the component', async () => {
    const { HomePage } = await import('./HomePage')
    expect(HomePage).toBeDefined()
  })

  it('renders the search bar when sessions exist', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Test session',
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    render(<HomePage />)
    expect(screen.getByPlaceholderText('Search sessions by title or keyword...')).toBeInTheDocument()
  })

  it('hides the search bar when no sessions exist', async () => {
    const { HomePage } = await import('./HomePage')
    render(<HomePage />)
    expect(screen.queryByPlaceholderText('Search sessions by title or keyword...')).not.toBeInTheDocument()
  })

  it('filters sessions by title match', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Search feature implementation',
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 5,
        createdAt: '2024-06-15T09:00:00Z',
      },
      {
        id: 's2',
        projectId: 'p1',
        title: 'Bug fix login',
        updatedAt: '2024-06-16T10:00:00Z',
        messageCount: 3,
        createdAt: '2024-06-16T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    render(<HomePage />)

    const input = screen.getByPlaceholderText('Search sessions by title or keyword...')
    await userEvent.type(input, 'search')

    await vi.waitFor(() => {
      expect(screen.getByText('1 match')).toBeInTheDocument()
    })

    expect(screen.getByRole('link', { name: /Search feature/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Bug fix/ })).not.toBeInTheDocument()
  })

  it('filters sessions by recent prompt content', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Session alpha',
        recentUserPrompts: [{ id: 'p1', content: 'Fix the login bug', timestamp: '2024-06-15T10:00:00Z' }],
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 2,
        createdAt: '2024-06-15T09:00:00Z',
      },
      {
        id: 's2',
        projectId: 'p1',
        title: 'Session beta',
        recentUserPrompts: [{ id: 'p2', content: 'Add dark mode', timestamp: '2024-06-16T10:00:00Z' }],
        updatedAt: '2024-06-16T10:00:00Z',
        messageCount: 4,
        createdAt: '2024-06-16T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    render(<HomePage />)

    const input = screen.getByPlaceholderText('Search sessions by title or keyword...')
    await userEvent.type(input, 'login')

    await vi.waitFor(() => {
      expect(screen.getByText('1 match')).toBeInTheDocument()
    })

    expect(screen.getByRole('link', { name: /Session a l/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Session b/ })).not.toBeInTheDocument()
  })

  it('shows clear button when search has text and clears on click', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Test session',
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    render(<HomePage />)

    const input = screen.getByPlaceholderText('Search sessions by title or keyword...')
    await userEvent.type(input, 'something')

    const clearButton = screen.getByLabelText('Clear search')
    expect(clearButton).toBeInTheDocument()

    await userEvent.click(clearButton)
    expect(input).toHaveValue('')
  })

  it('shows match count when searching', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Deploy pipeline',
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 5,
        createdAt: '2024-06-15T09:00:00Z',
      },
      {
        id: 's2',
        projectId: 'p1',
        title: 'DB migration',
        updatedAt: '2024-06-16T10:00:00Z',
        messageCount: 3,
        createdAt: '2024-06-16T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    render(<HomePage />)

    const input = screen.getByPlaceholderText('Search sessions by title or keyword...')
    await userEvent.type(input, 'deploy')

    await vi.waitFor(() => {
      expect(screen.getByText('1 match')).toBeInTheDocument()
    })
  })

  it('shows empty state when no sessions match', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Some session',
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    render(<HomePage />)

    const input = screen.getByPlaceholderText('Search sessions by title or keyword...')
    await userEvent.type(input, 'zzzzz')

    await vi.waitFor(() => {
      expect(screen.getByText(/No sessions matching/)).toBeInTheDocument()
    })

    expect(screen.getByText(/zzzzz/)).toBeInTheDocument()
  })

  it('shows projects and sessions when search is cleared', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'My session',
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    render(<HomePage />)

    const input = screen.getByPlaceholderText('Search sessions by title or keyword...')
    await userEvent.type(input, 'nope')

    await vi.waitFor(() => {
      expect(screen.getByText(/No sessions matching/)).toBeInTheDocument()
    })

    await userEvent.clear(input)

    await vi.waitFor(() => {
      expect(screen.getByText('My session')).toBeInTheDocument()
    })
  })
})
