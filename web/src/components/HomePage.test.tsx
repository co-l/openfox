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
  useLocation: () => [undefined, navigateMock],
}))

vi.mock('../lib/api', () => ({
  authFetch: vi.fn(),
}))

import { authFetch } from '../lib/api'
import { summariesResource } from '../lib/resources'
import { clearCache } from '../lib/resourceCache'

const { listHomeSessionsMock, listSessionsMock, ensureFullSessionListMock, navigateMock } = vi.hoisted(() => ({
  listHomeSessionsMock: vi.fn(),
  listSessionsMock: vi.fn(),
  ensureFullSessionListMock: vi.fn(),
  navigateMock: vi.fn(),
}))

const sessionStore = { sessions: [] as any[], sessionsWithPendingConfirmations: [] as string[] }
vi.mock('../stores/session', () => ({
  useSessionStore: (selector?: any) => {
    const state = {
      sessions: sessionStore.sessions,
      searchSessions: null,
      sessionsWithPendingConfirmations: sessionStore.sessionsWithPendingConfirmations,
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
    isStarred: false,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  },
  {
    id: 'p2',
    name: 'Project Beta',
    workdir: '/tmp/beta',
    isStarred: true,
    createdAt: '2024-01-02',
    updatedAt: '2024-01-02',
  },
  {
    id: 'p3',
    name: 'Project Gamma',
    workdir: '/tmp/gamma',
    isStarred: false,
    createdAt: '2024-01-03',
    updatedAt: '2024-01-03',
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

function makeSession(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    projectId: 'p1',
    title: `Session ${id}`,
    phase: 'plan',
    isRunning: false,
    isFavorite: false,
    createdAt: '2024-06-15T09:00:00Z',
    updatedAt: '2024-06-15T10:00:00Z',
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 1,
    ...overrides,
  }
}

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.innerHTML = ''
})

beforeEach(() => {
  sessionStore.sessions = []
  sessionStore.sessionsWithPendingConfirmations = []
  document.body.innerHTML = ''
  navigateMock.mockClear()
  listHomeSessionsMock.mockClear()
  listSessionsMock.mockClear()
  ensureFullSessionListMock.mockClear()
  // Seed the per-project counts so useResource serves from cache and no
  // out-of-act fetch fires on mount.
  clearCache()
  summariesResource.write({ counts: { open: 4, todo: 1, inProgress: 2, running: 1, queued: 1, done: 3 } }, 'p1')
  summariesResource.write({ counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 } }, 'p2')
  summariesResource.write({ counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 } }, 'p3')
  const authFetchMock = vi.mocked(authFetch)
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/p1/tasks/count')) {
      return {
        ok: true,
        json: async () => ({
          counts: { open: 4, todo: 1, inProgress: 2, running: 1, queued: 1, done: 3 },
        }),
      } as unknown as Response
    }
    if (url.endsWith('/p2/tasks/count') || url.endsWith('/p3/tasks/count')) {
      return {
        ok: true,
        json: async () => ({
          counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
        }),
      } as unknown as Response
    }
    return {
      ok: true,
      json: async () => ({
        tasks: [],
        settings: { slotLimit: 1, queuePaused: false },
        counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
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
    sessionStore.sessions = [makeSession('s1')]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    expect(container.querySelector('[placeholder="Search sessions by title or keyword..."]')).toBeTruthy()
  })

  it('shows the search bar even when no sessions exist', async () => {
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    expect(container.querySelector('[placeholder="Search sessions by title or keyword..."]')).toBeTruthy()
  })

  it('filters sessions by title match', async () => {
    sessionStore.sessions = [
      makeSession('s1', { title: 'Search feature implementation', messageCount: 5 }),
      makeSession('s2', { title: 'Bug fix login', updatedAt: '2024-06-16T10:00:00Z', messageCount: 3 }),
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
      makeSession('s1', {
        title: 'Session alpha',
        recentUserPrompts: [{ id: 'p1', content: 'Fix the login bug', timestamp: '2024-06-15T10:00:00Z' }],
      }),
      makeSession('s2', {
        title: 'Session beta',
        recentUserPrompts: [{ id: 'p2', content: 'Add dark mode', timestamp: '2024-06-16T10:00:00Z' }],
        updatedAt: '2024-06-16T10:00:00Z',
        messageCount: 4,
      }),
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
    sessionStore.sessions = [makeSession('s1')]
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
      makeSession('s1', { title: 'Deploy pipeline', messageCount: 5 }),
      makeSession('s2', { title: 'DB migration', updatedAt: '2024-06-16T10:00:00Z', messageCount: 3 }),
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
    sessionStore.sessions = [makeSession('s1', { title: 'Some session' })]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)

    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'zzzzz')

    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/No sessions matching/)
    })

    expect(container.textContent).toContain('zzzzz')
  })

  it('shows sessions when search is cleared', async () => {
    sessionStore.sessions = [makeSession('s1', { title: 'My session' })]
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
      makeSession('s1', { title: 'Setup docs' }),
      makeSession('s2', { projectId: 'p2', title: 'Analysis', updatedAt: '2024-06-16T10:00:00Z' }),
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
      makeSession('s1', { title: 'Deploy Pipeline' }),
      makeSession('s2', { title: 'Database migration', updatedAt: '2024-06-16T10:00:00Z' }),
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
      makeSession('s1', { title: 'Fix bug open frontend' }),
      makeSession('s2', { title: 'Open source bug tracker', updatedAt: '2024-06-16T10:00:00Z' }),
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'bug open')
    await vi.waitFor(() => expect(container.textContent).toContain('2 matches'))
    expect(container.textContent).toContain('Fix bug open')
    expect(container.textContent).toContain('Open source bug')
  })

  it('shows all matching sessions when searching (no 20-session limit)', async () => {
    const sessions = Array.from({ length: 25 }, (_, i) =>
      makeSession(`s${i}`, {
        title: `Fix bug ${i}`,
        updatedAt: `2024-06-${String(15 - (i % 15)).padStart(2, '0')}T10:00:00Z`,
      }),
    )
    sessionStore.sessions = sessions
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'fix')
    await vi.waitFor(() => expect(container.textContent).toContain('25 matches'))
    const visible = container.querySelectorAll('a[href*="/s/"]')
    expect(visible.length).toBe(25)
  })

  it('shows up to 20 most recent sessions ordered by last activity', async () => {
    const sessions = Array.from({ length: 25 }, (_, i) =>
      makeSession(`s${i}`, {
        title: `Session ${i}`,
        updatedAt: `2024-06-${String(25 - i).padStart(2, '0')}T10:00:00Z`,
      }),
    )
    sessionStore.sessions = sessions
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const links = container.querySelectorAll('a[href*="/s/"]')
    expect(links.length).toBe(20)
    // Most recently updated first: s0 (06-25) down to s19 (06-06).
    expect(textOf(links[0] as HTMLElement | null)).toContain('Session 0')
    expect(textOf(links[1] as HTMLElement | null)).toContain('Session 1')
    expect(textOf(links[19] as HTMLElement | null)).toContain('Session 19')
  })

  it('orders recent sessions by last activity across projects', async () => {
    sessionStore.sessions = [
      makeSession('s1', { projectId: 'p1', title: 'Older', updatedAt: '2024-06-14T10:00:00Z' }),
      makeSession('s2', { projectId: 'p2', title: 'Newer', updatedAt: '2024-06-16T10:00:00Z' }),
      makeSession('s3', { projectId: 'p3', title: 'Middle', updatedAt: '2024-06-15T10:00:00Z' }),
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const links = container.querySelectorAll('a[href*="/s/"]')
    expect(textOf(links[0] as HTMLElement | null)).toContain('Newer')
    expect(textOf(links[1] as HTMLElement | null)).toContain('Middle')
    expect(textOf(links[2] as HTMLElement | null)).toContain('Older')
  })

  it('renders session rows as links (anchors), not buttons', async () => {
    sessionStore.sessions = [makeSession('s1', { title: 'Clickable session' })]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const row = container.querySelector('a[href="/p/p1/s/s1"]')
    expect(row).toBeTruthy()
    expect(row!.tagName).toBe('A')
    // No button navigates to a session.
    expect(container.querySelector('button[title="Clickable session"]')).toBeNull()
  })

  it('shows a status dot for running and waiting sessions', async () => {
    sessionStore.sessions = [
      makeSession('s1', { isRunning: true, title: 'Busy' }),
      makeSession('s2', { title: 'Needs input', phase: 'blocked' }),
    ]
    sessionStore.sessionsWithPendingConfirmations = ['s2']
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    expect(container.querySelector('[title="Running"]')).toBeTruthy()
    expect(container.querySelector('[title="Waiting for your input"]')).toBeTruthy()
  })

  it('shows the project name on each session row', async () => {
    sessionStore.sessions = [makeSession('s1', { projectId: 'p1' })]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const row = container.querySelector('a[href="/p/p1/s/s1"]')!.closest('div')
    expect(row?.textContent).toContain('Project Alpha')
  })

  it('opens a project dropdown from the session row with a New Session link and a Tasks action', async () => {
    sessionStore.sessions = [makeSession('s1', { projectId: 'p1' })]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)

    const trigger = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Project Alpha'),
    )
    expect(trigger).toBeTruthy()
    await userEvent.click(trigger!)

    const menu = document.querySelector('[data-testid="session-dropdown-menu"]')
    expect(menu).toBeTruthy()
    const newSession = menu!.querySelector('a[href="/p/p1/new"]')
    expect(newSession).toBeTruthy()
    expect(newSession?.textContent).toContain('New Session')
    expect(menu!.textContent).toContain('Tasks')
    await userEvent.click(newSession!)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('opens the Tasks modal from the session-row project dropdown', async () => {
    sessionStore.sessions = [makeSession('s1', { projectId: 'p1' })]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)

    const trigger = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Project Alpha'),
    )!
    await userEvent.click(trigger!)

    const menu = document.querySelector('[data-testid="session-dropdown-menu"]')!
    const tasksItem = Array.from(menu.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Tasks')
    expect(tasksItem).toBeTruthy()
    await userEvent.click(tasksItem!)

    await vi.waitFor(() => {
      expect(document.querySelector('[placeholder="Search tasks…"]')).toBeTruthy()
    })
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('keeps the project dropdown trigger outside the session link', async () => {
    sessionStore.sessions = [makeSession('s1', { projectId: 'p1' })]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)

    const link = container.querySelector('a[href="/p/p1/s/s1"]')!
    const trigger = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Project Alpha'),
    )!
    expect(trigger).toBeTruthy()
    expect(link.contains(trigger)).toBe(false)

    await userEvent.click(trigger)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('navigates to the session when clicking the row outside the link (status dot)', async () => {
    sessionStore.sessions = [makeSession('s1', { projectId: 'p1' })]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)

    const row = container.querySelector('a[href="/p/p1/s/s1"]')!.closest('div')!
    await userEvent.click(row.children[0] as HTMLElement)
    expect(navigateMock).toHaveBeenCalledWith('/p/p1/s/s1')
  })

  it('shows prompts badge when session matches by prompts only', async () => {
    sessionStore.sessions = [
      makeSession('s1', {
        title: 'Session alpha',
        recentUserPrompts: [{ id: 'p1', content: 'Please review the PR', timestamp: '2024-06-15T10:00:00Z' }],
      }),
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
      makeSession('s1', {
        title: 'Review PR 123',
        recentUserPrompts: [{ id: 'p1', content: 'Please check this', timestamp: '2024-06-15T10:00:00Z' }],
      }),
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
      makeSession('s1', {
        title: 'QA workflow',
        recentUserPrompts: [
          { id: 'p1', content: 'Run full code review on the project', timestamp: '2024-06-15T10:00:00Z' },
        ],
      }),
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
      makeSession('s1', {
        title: 'Error in checkout flow',
        recentUserPrompts: [{ id: 'p1', content: 'Check error handling', timestamp: '2024-06-14T10:00:00Z' }],
        updatedAt: '2024-06-14T10:00:00Z',
      }),
      makeSession('s2', {
        title: 'UI improvements',
        recentUserPrompts: [{ id: 'p2', content: 'Fix the error in modal', timestamp: '2024-06-15T10:00:00Z' }],
        updatedAt: '2024-06-15T10:00:00Z',
      }),
    ]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'error')
    await vi.waitFor(() => expect(container.textContent).toContain('2 matches'))
    const links = container.querySelectorAll('a[href*="/s/"]')
    expect(textOf(links[0] as HTMLElement | null)).toContain('Error in checkout')
    expect(textOf(links[1] as HTMLElement | null)).toContain('UI improvements')
  })

  it('clears search on Escape key', async () => {
    sessionStore.sessions = [makeSession('s1', { title: 'My session' })]
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
    sessionStore.sessions = [makeSession('abcdef123456', { title: undefined, projectId: 'p1' })]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    expect(container.textContent).toContain('abcdef12')
  })

  it('renders a session with a missing project as a plain row, not a dead link', async () => {
    sessionStore.sessions = [makeSession('s1', { projectId: 'ghost', title: 'Orphan' })]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    expect(container.querySelector('a[href="#"]')).toBeNull()
    expect(container.querySelector('a[href*="/s/"]')).toBeNull()
    expect(container.textContent).toContain('Orphan')
  })

  it('mounts with the lean home list and lazily loads the full corpus only when searching', async () => {
    sessionStore.sessions = [makeSession('s1', { title: 'Alpha session' })]
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

  it('keeps the projects section visible while searching, even with no session matches', async () => {
    sessionStore.sessions = [makeSession('s1', { title: 'Some session' })]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)

    const input = container.querySelector('[placeholder="Search sessions by title or keyword..."]')!
    await userEvent.type(input, 'zzzzz')

    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/No sessions matching/)
    })
    expect(container.querySelector('[aria-label="Projects"]')).toBeTruthy()
    expect(container.querySelector('a[href="/p/p1"]')).toBeTruthy()
  })

  it('orders projects starred first, then alphabetically', async () => {
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const projectLinks = Array.from(container.querySelectorAll('a[href="/p/p1"], a[href="/p/p2"], a[href="/p/p3"]'))
    const names = projectLinks.map((a) => a.textContent?.trim())
    // Starred Beta first, then Alpha and Gamma alphabetically.
    expect(names).toEqual(['Project Beta', 'Project Alpha', 'Project Gamma'])
  })

  it('shows a star icon for starred projects and a folder icon for others', async () => {
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const betaCard = container.querySelector('a[href="/p/p2"]')!.closest('div.bg-bg-secondary')!
    expect(betaCard.querySelector('svg.text-yellow-500')).toBeTruthy()
    const alphaCard = container.querySelector('a[href="/p/p1"]')!.closest('div.bg-bg-secondary')!
    expect(alphaCard.querySelector('svg.text-yellow-500')).toBeNull()
  })

  it('keeps project cards free of session rows', async () => {
    sessionStore.sessions = [makeSession('s1', { projectId: 'p1' })]
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)
    const projectsSection = container.querySelector('[aria-label="Projects"]')
    expect(projectsSection?.querySelectorAll('a[href*="/s/"]').length).toBe(0)
    const sessionsSection = container.querySelector('[aria-label="Recent sessions"]')
    expect(sessionsSection?.querySelectorAll('a[href*="/s/"]').length).toBe(1)
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

  it('deletes a project after confirming in the modal', async () => {
    const { HomePage } = await import('./HomePage')
    const container = render(<HomePage />)

    const alphaCard = container.querySelector('a[href="/p/p1"]')!.closest('div.bg-bg-secondary')!
    const trash = alphaCard.querySelector<HTMLElement>('[title="Delete project"]')!
    await userEvent.click(trash)

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Delete Project')
    })

    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete',
    )
    expect(confirmButton).toBeTruthy()
    await userEvent.click(confirmButton!)

    await vi.waitFor(() => {
      expect(deleteProjectMock).toHaveBeenCalledWith('p1')
    })
  })
})
