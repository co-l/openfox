// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import userEvent from '@testing-library/user-event'

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

vi.mock('../lib/api', () => ({
  authFetch: vi.fn(),
}))

import { authFetch } from '../lib/api'
import { summariesResource } from '../lib/resources'
import { clearCache } from '../lib/resourceCache'

const { listHomeSessionsMock, listSessionsMock, ensureFullSessionListMock } = vi.hoisted(() => ({
  listHomeSessionsMock: vi.fn(),
  listSessionsMock: vi.fn(),
  ensureFullSessionListMock: vi.fn(),
}))

const sessionStore = { sessions: [] as any[] }
vi.mock('../stores/session', () => ({
  useSessionStore: (selector?: any) => {
    const state = {
      sessions: sessionStore.sessions,
      searchSessions: null,
      sessionsWithPendingConfirmations: [],
      listSessions: listSessionsMock,
      listHomeSessions: listHomeSessionsMock,
      ensureFullSessionList: ensureFullSessionListMock,
      connectionStatus: 'connected',
    }
    return selector ? selector(state) : state
  },
}))

const { deleteProjectMock } = vi.hoisted(() => ({
  deleteProjectMock: vi.fn(),
}))

const projectFixtures = [
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
]

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ projects: projectFixtures, refresh: vi.fn(), loading: false }),
}))

vi.mock('../stores/project', () => ({
  useProjectStore: (selector?: any) => {
    const state = {
      deleteProject: deleteProjectMock,
    }
    return selector ? selector(state) : state
  },
}))

const mountedRoots: Array<ReturnType<typeof createRoot>> = []

function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  act(() => {
    root.render(ui)
  })
  return container
}

function textOf(el: HTMLElement | null): string {
  return el?.textContent ?? ''
}

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.innerHTML = ''
})

beforeEach(() => {
  sessionStore.sessions = []
  document.body.innerHTML = ''
  listHomeSessionsMock.mockClear()
  listSessionsMock.mockClear()
  ensureFullSessionListMock.mockClear()
  // Seed the per-project counts so useResource serves from cache and no
  // out-of-act fetch fires on mount.
  clearCache()
  summariesResource.write(
    { counts: { open: 4, backlog: 0, todo: 1, inProgress: 2, running: 1, queued: 1, review: 0, done: 3 } },
    'p1',
  )
  summariesResource.write(
    { counts: { open: 0, backlog: 0, todo: 0, inProgress: 0, running: 0, queued: 0, review: 0, done: 0 } },
    'p2',
  )
  const authFetchMock = vi.mocked(authFetch)
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/p1/tasks/count')) {
      return {
        ok: true,
        json: async () => ({
          counts: { open: 4, backlog: 0, todo: 1, inProgress: 2, running: 1, queued: 1, review: 0, done: 3 },
        }),
      } as unknown as Response
    }
    if (url.endsWith('/p2/tasks/count')) {
      return {
        ok: true,
        json: async () => ({
          counts: { open: 0, backlog: 0, todo: 0, inProgress: 0, running: 0, queued: 0, review: 0, done: 0 },
        }),
      } as unknown as Response
    }
    return {
      ok: true,
      json: async () => ({
        tasks: [],
        settings: { slotLimit: 1, queuePaused: false },
        counts: { open: 0, backlog: 0, todo: 0, inProgress: 0, running: 0, queued: 0, review: 0, done: 0 },
        gates: [],
      }),
    } as unknown as Response
  })
})

describe('HomePage', () => {
  it('exports the component', async () => {
    const { HomePage } = await import('./HomePage')
    expect(HomePage).toBeDefined()
  })

  it('links to the split-view route from the homepage entry point', async () => {
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const link = container.querySelector('a[href="/split-view"]')
    expect(link).toBeTruthy()
    expect(link?.textContent).toContain('Open split view')
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
    const container = render(<HomePage />)
    expect(container.querySelector('[placeholder="Search sessions by title or keyword..."]')).toBeTruthy()
  })

  it('hides the search bar when no sessions exist', async () => {
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    expect(container.querySelector('[placeholder="Search sessions by title or keyword..."]')).toBeNull()
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
    const container = render(<HomePage />)

    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'search')

    await vi.waitFor(() => {
      expect(container.textContent).toContain('1 match')
    })

    expect(textOf(container.querySelector('a[href*="/s/"]'))).toContain('Search feature')
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
    const container = render(<HomePage />)

    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'login')

    await vi.waitFor(() => {
      expect(container.textContent).toContain('1 match')
    })

    expect(container.textContent).toContain('Session alpha')
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
    const container = render(<HomePage />)

    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')! as HTMLInputElement
    await userEvent.type(input, 'something')

    const clearButton = container.querySelector('[aria-label="Clear search"]')
    expect(clearButton).toBeTruthy()

    await userEvent.click(clearButton!)
    expect(input.value).toBe('')
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
    const container = render(<HomePage />)

    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'deploy')

    await vi.waitFor(() => {
      expect(container.textContent).toContain('1 match')
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
    const container = render(<HomePage />)

    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'zzzzz')

    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/No sessions matching/)
    })

    expect(container.textContent).toContain('zzzzz')
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
    const container = render(<HomePage />)

    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'nope')

    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/No sessions matching/)
    })

    await userEvent.clear(input)

    await vi.waitFor(() => {
      expect(container.textContent).toContain('My session')
    })
  })

  it('filters by project name', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Setup docs',
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
      {
        id: 's2',
        projectId: 'p2',
        title: 'Analysis',
        updatedAt: '2024-06-16T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-16T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'beta')
    await vi.waitFor(() => expect(container.textContent).toContain('1 match'))
    expect(container.textContent).toContain('Project Beta')
    expect(container.textContent).not.toContain('Setup docs')
  })

  it('filters by case-insensitive matching', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Deploy Pipeline',
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
      {
        id: 's2',
        projectId: 'p1',
        title: 'Database migration',
        updatedAt: '2024-06-16T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-16T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'DEPLOY')
    await vi.waitFor(() => expect(container.textContent).toContain('1 match'))
    expect(container.textContent).toContain('Deploy Pipeline')
  })

  it('requires all space-separated query words to match', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Fix bug open frontend',
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
      {
        id: 's2',
        projectId: 'p1',
        title: 'Open source bug tracker',
        updatedAt: '2024-06-16T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-16T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'bug open')
    await vi.waitFor(() => expect(container.textContent).toContain('2 matches'))
    expect(container.textContent).toContain('Fix bug open')
    expect(container.textContent).toContain('Open source bug')
  })

  it('shows only projects with matching sessions', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Database setup',
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
      {
        id: 's2',
        projectId: 'p2',
        title: 'Frontend',
        updatedAt: '2024-06-16T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-16T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'database')
    await vi.waitFor(() => expect(container.textContent).toContain('1 match'))
    expect(container.textContent).toContain('Project Alpha')
    expect(container.textContent).not.toContain('Project Beta')
  })

  it('limits to 5 sessions per project when not searching', async () => {
    const sessions = Array.from({ length: 7 }, (_, i) => ({
      id: `s${i}`,
      projectId: 'p1',
      title: `Session ${i}`,
      updatedAt: `2024-06-${String(15 - i).padStart(2, '0')}T10:00:00Z`,
      messageCount: 1,
      createdAt: '2024-06-01',
    }))
    sessionStore.sessions = sessions
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const visible = container.querySelectorAll('a[href*="/s/"]')
    expect(visible.length).toBe(5)
  })

  it('shows all matching sessions when searching (no 5-session limit)', async () => {
    const sessions = Array.from({ length: 7 }, (_, i) => ({
      id: `s${i}`,
      projectId: 'p1',
      title: `Fix bug ${i}`,
      updatedAt: `2024-06-${String(15 - i).padStart(2, '0')}T10:00:00Z`,
      messageCount: 1,
      createdAt: '2024-06-01',
    }))
    sessionStore.sessions = sessions
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'fix')
    await vi.waitFor(() => expect(container.textContent).toContain('7 matches'))
    const visible = container.querySelectorAll('a[href*="/s/"]')
    expect(visible.length).toBe(7)
  })

  it('shows prompts badge when session matches by prompts only', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Session alpha',
        recentUserPrompts: [{ id: 'p1', content: 'Please review the PR', timestamp: '2024-06-15T10:00:00Z' }],
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'review')
    await vi.waitFor(() => expect(container.textContent).toContain('1 match'))
    expect(container.textContent).toContain('prompts')
  })

  it('does not show prompts badge when session matches by title', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Review PR 123',
        recentUserPrompts: [{ id: 'p1', content: 'Please check this', timestamp: '2024-06-15T10:00:00Z' }],
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'review')
    await vi.waitFor(() => expect(container.textContent).toContain('1 match'))
    expect(container.textContent).not.toContain('prompts')
  })

  it('shows snippet with highlighted keyword in prompts match', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'QA workflow',
        recentUserPrompts: [
          { id: 'p1', content: 'Run full code review on the project', timestamp: '2024-06-15T10:00:00Z' },
        ],
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'review')
    await vi.waitFor(() => expect(container.textContent).toContain('prompts'))
    expect(container.textContent).toContain('Run full code')
  })

  it('ranks title matches above prompt matches', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Error in checkout flow',
        recentUserPrompts: [{ id: 'p1', content: 'Check error handling', timestamp: '2024-06-14T10:00:00Z' }],
        updatedAt: '2024-06-14T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-14T09:00:00Z',
      },
      {
        id: 's2',
        projectId: 'p1',
        title: 'UI improvements',
        recentUserPrompts: [{ id: 'p2', content: 'Fix the error in modal', timestamp: '2024-06-15T10:00:00Z' }],
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'error')
    await vi.waitFor(() => expect(container.textContent).toContain('2 matches'))
    const links = container.querySelectorAll('a[href*="/s/"]')
    expect(links[0]?.textContent).toContain('Error in checkout')
    expect(links[1]?.textContent).toContain('UI improvements')
  })

  it('clears search on Escape key', async () => {
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
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')! as HTMLInputElement
    await userEvent.type(input, 'zzzzz')
    await vi.waitFor(() => expect(container.textContent).toMatch(/No sessions matching/))
    await userEvent.keyboard('{Escape}')
    expect(input.value).toBe('')
    expect(container.textContent).toContain('My session')
  })

  it('handles session without a title by falling back to id slice', async () => {
    sessionStore.sessions = [
      {
        id: 'abcdef123456',
        projectId: 'p1',
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    expect(container.textContent).toContain('abcdef12')
  })

  it('mounts with the lean home list and lazily loads the full corpus only when searching', async () => {
    sessionStore.sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Alpha session',
        updatedAt: '2024-06-15T10:00:00Z',
        messageCount: 1,
        createdAt: '2024-06-15T09:00:00Z',
      },
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)

    expect(listHomeSessionsMock).toHaveBeenCalledTimes(1)
    expect(listSessionsMock).not.toHaveBeenCalled()
    expect(ensureFullSessionListMock).not.toHaveBeenCalled()

    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'alp')

    await vi.waitFor(() => {
      expect(ensureFullSessionListMock).toHaveBeenCalledTimes(1)
    })
  })

  it('shows a per-project Tasks button with color-coded state counts', async () => {
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)

    const alphaTasks = container.querySelector<HTMLElement>('[aria-label="Tasks for Project Alpha"]')
    expect(alphaTasks).toBeTruthy()

    // p1: todo 1, running 1, queued 1, done 3 — nonzero chips only.
    await vi.waitFor(() => {
      expect(textOf(alphaTasks)).toContain('1')
    })
    expect(textOf(alphaTasks)).toContain('3')
    expect(textOf(alphaTasks)).not.toContain('0')

    // p2 has no tasks at all: the button shows the label and icon, no chips.
    const betaTasks = container.querySelector<HTMLElement>('[aria-label="Tasks for Project Beta"]')
    expect(textOf(betaTasks)).toBe('Tasks')
  })

  it('opens the Tasks modal for the clicked project', async () => {
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)

    const alphaTasks = container.querySelector<HTMLElement>('[aria-label="Tasks for Project Alpha"]')!
    await userEvent.click(alphaTasks)

    // The modal portals to document.body, so assert there rather than on the
    // homepage wrapper.
    await vi.waitFor(() => {
      expect(document.querySelector('[placeholder="Search tasks…"]')).toBeTruthy()
    })
  })
})
