// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockNavigate = vi.fn()
const mockListSessions = vi.fn()
const mockLoadMoreSessions = vi.fn()

let sessions: any[] = []

vi.mock('wouter', () => ({
  useLocation: () => [undefined, mockNavigate],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector?: any) => {
    const state = {
      sessions,
      currentSession: null,
      unreadSessionIds: [],
      sessionsWithPendingConfirmations: [],
      pendingPathConfirmations: [],
      sessionsHasMore: false,
      sessionsPaginationLoading: false,
      listSessions: mockListSessions,
      loadMoreSessions: mockLoadMoreSessions,
      deleteSession: vi.fn(),
      deleteAllSessions: vi.fn(),
      renameSession: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../../stores/project', () => ({
  useProjectStore: (selector?: any) => {
    const state = {
      currentProject: { id: 'project-1', name: 'Project', workdir: '/tmp/project' },
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../settings/ProjectSettingsModal', () => ({
  ProjectSettingsModal: () => null,
}))

vi.mock('../shared/DropdownMenu', () => ({
  DropdownMenu: ({ trigger }: { trigger: React.ReactNode }) => <div data-testid="dropdown-trigger">{trigger}</div>,
}))

vi.mock('../shared/Button', () => ({
  Button: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode
    onClick?: () => void
    className?: string
  }) => (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('../shared/CloseButton', () => ({
  CloseButton: ({ onClick, className }: { onClick?: () => void; className?: string }) => (
    <button className={className} onClick={onClick} data-testid="close-button">
      X
    </button>
  ),
}))

vi.mock('../shared/ConfirmModal', () => ({
  ConfirmModal: () => null,
}))

vi.mock('../shared/Modal', () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div data-testid="modal">{children}</div>,
}))

vi.mock('../shared/ModalFooter', () => ({
  ModalFooter: () => null,
}))

vi.mock('../shared/icons', () => ({
  EllipsisIcon: () => <span data-testid="ellipsis-icon">...</span>,
  SpinIcon: () => <span data-testid="spin-icon" className="animate-spin" />,
  StopIcon: () => <span data-testid="stop-icon" />,
  SearchIcon: () => <span data-testid="search-icon">🔍</span>,
  XCloseIcon: () => <span data-testid="xclose-icon">✕</span>,
}))

beforeEach(() => {
  cleanup()
  sessions = []
  document.body.innerHTML = ''
})

describe('Sidebar session search', () => {
  it('shows the search input above the session list (criterion 0)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'My session',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const searchInput = screen.queryByPlaceholderText(/search/i)
    expect(searchInput).toBeTruthy()
  })

  it('filters sessions by fuzzy title match (criterion 1)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'Implement search feature',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 5,
      },
      {
        id: 's2',
        projectId: 'project-1',
        title: 'Bug fix login',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-16T09:00:00Z',
        updatedAt: '2024-06-16T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 3,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const input = screen.getByPlaceholderText(/search/i)
    await userEvent.type(input, 'search')

    await vi.waitFor(() => {
      expect(screen.getByRole('link', { name: /Implement search feature/ })).toBeTruthy()
    })
    expect(screen.queryByRole('link', { name: /Bug fix login/ })).toBeNull()
  })

  it('filters sessions by recentUserPrompts content (criterion 1)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'Session alpha',
        recentUserPrompts: [{ id: 'p1', content: 'Fix the login bug', timestamp: '2024-06-15T10:00:00Z' }],
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 2,
      },
      {
        id: 's2',
        projectId: 'project-1',
        title: 'Session beta',
        recentUserPrompts: [{ id: 'p2', content: 'Add dark mode', timestamp: '2024-06-16T10:00:00Z' }],
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-16T09:00:00Z',
        updatedAt: '2024-06-16T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 4,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const input = screen.getByPlaceholderText(/search/i)
    await userEvent.type(input, 'login')

    await vi.waitFor(() => {
      const titles = screen.getAllByRole('link').map((l) => l.textContent ?? '')
      expect(titles.some((t) => t.includes('Session alpha'))).toBe(true)
    })
    const titlesAfter = screen.getAllByRole('link').map((l) => l.textContent ?? '')
    expect(titlesAfter.some((t) => t.includes('Session beta'))).toBe(false)
  })

  it('uses fuzzyMatch for non-contiguous character matching (criterion 1)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'Implement search feature',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
      {
        id: 's2',
        projectId: 'project-1',
        title: 'Bug report analysis',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-16T09:00:00Z',
        updatedAt: '2024-06-16T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const input = screen.getByPlaceholderText(/search/i)
    // Non-contiguous fuzzy: "srch" matches "search" (s, then r, then c, then h)
    await userEvent.type(input, 'srch')

    await vi.waitFor(() => {
      const titles = screen.getAllByRole('link').map((l) => l.textContent ?? '')
      expect(titles.some((t) => t.includes('Implement search feature'))).toBe(true)
    })
  })

  it('highlights matching characters with font-semibold text-accent-primary (criterion 2)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'Deploy pipeline',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const input = screen.getByPlaceholderText(/search/i)
    await userEvent.type(input, 'deploy')

    await vi.waitFor(() => {
      const highlighted = document.querySelectorAll('.font-semibold.text-accent-primary')
      expect(highlighted.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows a clear button (X) when search text is entered (criterion 3)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'Test session',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement
    await userEvent.type(input, 'something')

    const clearButton = screen.queryByLabelText(/clear/i) ?? screen.queryByRole('button', { name: /clear/i })
    expect(clearButton).toBeTruthy()

    expect(input.value).toBe('something')
  })

  it('clears search text and removes focus on Escape key (criterion 3)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'Test session',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement
    await userEvent.type(input, 'test')

    await vi.waitFor(() => {
      expect(input.value).toBe('test')
    })

    await userEvent.keyboard('{Escape}')

    await vi.waitFor(() => {
      expect(input.value).toBe('')
    })
    expect(document.activeElement).not.toBe(input)
  })

  it('shows result count when search is active (criterion 4)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'Deploy pipeline',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 5,
      },
      {
        id: 's2',
        projectId: 'project-1',
        title: 'DB migration',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-16T09:00:00Z',
        updatedAt: '2024-06-16T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 3,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const input = screen.getByPlaceholderText(/search/i)
    await userEvent.type(input, 'deploy')

    await vi.waitFor(() => {
      expect(screen.getByText(/1 match/)).toBeTruthy()
    })
  })

  it('shows "No matching sessions" when no results match (criterion 4)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'Some session',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const input = screen.getByPlaceholderText(/search/i)
    await userEvent.type(input, 'zzzzz')

    await vi.waitFor(() => {
      expect(screen.getByText(/no matching sessions/i)).toBeTruthy()
    })
  })

  it('filtering is purely client-side and does not trigger loadMoreSessions (criterion 5)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'My session',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const input = screen.getByPlaceholderText(/search/i)
    await userEvent.type(input, 'my')

    // Wait a bit to ensure no async call fires
    await vi.waitFor(() => {
      expect(screen.getByText(/1 match/)).toBeTruthy()
    })
    expect(mockLoadMoreSessions).not.toHaveBeenCalled()
  })

  it('filters sessions by fuzzy match on partial input (criterion 6)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'Specific session title',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
      {
        id: 's2',
        projectId: 'project-1',
        title: 'Other session',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-16T09:00:00Z',
        updatedAt: '2024-06-16T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement

    await userEvent.type(input, 'spec')
    await vi.waitFor(
      () => {
        const titles = screen.getAllByRole('link').map((l) => l.textContent ?? '')
        expect(titles.some((t) => t.includes('Specific session title'))).toBe(true)
      },
      { timeout: 300 },
    )
  })

  it('does not show match count or filter when input is empty (criterion 0/4)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'My session',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    expect(screen.queryByText(/match/)).toBeNull()
    expect(screen.getByText('My session')).toBeTruthy()
  })

  it('filters by case-insensitive matching (criterion 1)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'Deploy Pipeline',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const input = screen.getByPlaceholderText(/search/i)
    await userEvent.type(input, 'DEPLOY')

    await vi.waitFor(() => {
      expect(screen.getByRole('link', { name: /Deploy Pipeline/ })).toBeTruthy()
    })
  })

  it('recovers all sessions after search is cleared (criterion 3)', async () => {
    sessions = [
      {
        id: 's1',
        projectId: 'project-1',
        title: 'Alpha',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-15T09:00:00Z',
        updatedAt: '2024-06-15T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
      {
        id: 's2',
        projectId: 'project-1',
        title: 'Beta',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        createdAt: '2024-06-16T09:00:00Z',
        updatedAt: '2024-06-16T10:00:00Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 1,
      },
    ]
    const { Sidebar } = await import('./Sidebar')
    render(<Sidebar projectId="project-1" />)

    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement
    await userEvent.type(input, 'alpha')

    await vi.waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy()
    })
    expect(screen.queryByText('Beta')).toBeNull()

    await userEvent.clear(input)

    await vi.waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy()
    })
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  describe('Ctrl+S shortcut behavior', () => {
    it('closes sidebar when search is already focused and Ctrl+S is pressed', async () => {
      sessions = [
        {
          id: 's1',
          projectId: 'project-1',
          title: 'My session',
          workdir: '/tmp/project',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          createdAt: '2024-06-15T09:00:00Z',
          updatedAt: '2024-06-15T10:00:00Z',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 1,
        },
      ]
      const onClose = vi.fn()
      const { Sidebar } = await import('./Sidebar')
      render(<Sidebar projectId="project-1" isOpen={true} onClose={onClose} />)

      const searchInput = screen.getByPlaceholderText(/search/i) as HTMLInputElement
      searchInput.focus()
      expect(document.activeElement).toBe(searchInput)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('focuses search without closing sidebar when search is not focused and Ctrl+S is pressed', async () => {
      sessions = [
        {
          id: 's1',
          projectId: 'project-1',
          title: 'My session',
          workdir: '/tmp/project',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          createdAt: '2024-06-15T09:00:00Z',
          updatedAt: '2024-06-15T10:00:00Z',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 1,
        },
      ]
      const onClose = vi.fn()
      const { Sidebar } = await import('./Sidebar')
      render(<Sidebar projectId="project-1" isOpen={true} onClose={onClose} />)

      // Focus something else so search is not focused
      const searchInput = screen.getByPlaceholderText(/search/i) as HTMLInputElement
      expect(searchInput).toBeTruthy()
      // Click on the aside to move focus away from search
      document.body.focus()
      expect(document.activeElement).not.toBe(searchInput)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))

      // Should NOT close the sidebar
      expect(onClose).not.toHaveBeenCalled()
      // Search should now be focused
      expect(document.activeElement).toBe(searchInput)
    })
  })
})
