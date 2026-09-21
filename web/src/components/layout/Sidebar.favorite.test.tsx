// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { Sidebar } from './Sidebar'
import type { SessionSummary } from '@shared/types.js'
import { formatTime } from '../../lib/format-date'

const mockNavigate = vi.fn()
const mockToggleFavorite = vi.fn()

vi.mock('wouter', () => ({
  useLocation: () => [undefined, mockNavigate],
  Link: ({ children, href, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

const sessionStoreState = {
  sessions: [] as SessionSummary[],
  currentSession: null,
  unreadSessionIds: [],
  sessionsWithPendingConfirmations: [],
  pendingPathConfirmations: [],
  sessionsHasMore: false,
  sessionsPaginationLoading: false,
  listSessions: vi.fn(),
  loadMoreSessions: vi.fn(),
  deleteSession: vi.fn(),
  deleteAllSessions: vi.fn(),
  renameSession: vi.fn(),
  toggleFavorite: mockToggleFavorite,
}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: typeof sessionStoreState) => unknown) => selector(sessionStoreState),
}))

vi.mock('../../hooks/useCurrentProject', () => ({
  useCurrentProject: () => ({ id: 'project-1', name: 'Project', workdir: '/tmp/project' }),
}))

vi.mock('../settings/ProjectSettingsModal', () => ({
  ProjectSettingsModal: () => null,
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

vi.mock('../shared/CloseButton', () => ({
  CloseButton: () => <button data-testid="close-button">X</button>,
}))

vi.mock('../shared/Button', () => ({
  Button: ({ children, onClick, className }: any) => (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('../shared/icons', () => ({
  EllipsisIcon: () => <span data-testid="ellipsis-icon">...</span>,
  SpinIcon: () => <span data-testid="spin-icon" />,
  StopIcon: () => <span data-testid="stop-icon" />,
  SearchIcon: () => <span data-testid="search-icon">🔍</span>,
  XCloseIcon: () => <span data-testid="xclose-icon">✕</span>,
  StarIcon: () => <span data-testid="star-icon">☆</span>,
  StarFilledIcon: () => <span data-testid="star-filled-icon">★</span>,
  DownloadIcon: () => <span data-testid="download-icon" />,
  UploadIcon: () => <span data-testid="upload-icon" />,
  GearIcon: () => <span data-testid="gear-icon" />,
  TrashIcon: () => <span data-testid="trash-icon" />,
  EditSmallIcon: () => <span data-testid="edit-small-icon" />,
}))

function session(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    projectId: 'project-1',
    title: 'Untitled',
    workdir: '/tmp/project',
    mode: 'planner',
    phase: 'plan',
    isRunning: false,
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    isFavorite: false,
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 0,
    ...overrides,
  }
}

function renderSidebar(): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<Sidebar projectId="project-1" />)
  })
  return container
}

function click(node: Element | null | undefined) {
  if (!node) throw new Error('Expected click target to exist')
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function findOptionsButton(sessionTitle: string): HTMLElement | null {
  const links = Array.from(document.querySelectorAll('a[href^="/p/"]'))
  const link = links.find((l) => l.textContent?.includes(sessionTitle))
  return link?.querySelector('button[title="Options"]') ?? null
}

function findMenu(): HTMLElement | null {
  return document.querySelector('[data-testid="session-dropdown-menu"]')
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  sessionStoreState.sessions = []
})

describe('Sidebar favorites', () => {
  it('does not render a standalone star button in session rows', () => {
    sessionStoreState.sessions = [session({ id: 'session-1', title: 'Alpha' })]
    renderSidebar()

    const stars = document.querySelectorAll('button[title="Add to favorites"], button[title="Remove from favorites"]')
    expect(stars.length).toBe(0)
  })

  it('opens the options menu which contains the favorite toggle', () => {
    sessionStoreState.sessions = [session({ id: 'session-1', title: 'Alpha' })]
    renderSidebar()

    click(findOptionsButton('Alpha'))

    const menu = findMenu()
    expect(menu).toBeTruthy()
    expect(menu?.textContent).toContain('Add to favorites')
  })

  it('unfavorites a favorite session from the options menu without navigating', () => {
    sessionStoreState.sessions = [
      session({ id: 'session-1', title: 'Alpha' }),
      session({ id: 'session-2', title: 'Beta', isFavorite: true }),
    ]
    renderSidebar()

    click(findOptionsButton('Beta'))
    const menu = findMenu()
    expect(menu?.textContent).toContain('Remove from favorites')

    const item = Array.from(menu?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('Remove from favorites'),
    )
    click(item)

    expect(mockToggleFavorite).toHaveBeenCalledWith('session-2', false)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('favorites a non-favorite session from the options menu', () => {
    sessionStoreState.sessions = [session({ id: 'session-1', title: 'Alpha' })]
    renderSidebar()

    click(findOptionsButton('Alpha'))
    const menu = findMenu()
    const item = Array.from(menu?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('Add to favorites'),
    )
    click(item)

    expect(mockToggleFavorite).toHaveBeenCalledWith('session-1', true)
  })

  it('hides the time for favorite sessions but keeps it for others', () => {
    sessionStoreState.sessions = [
      session({ id: 'session-1', title: 'Alpha', updatedAt: '2026-08-01T10:00:00Z' }),
      session({ id: 'session-2', title: 'Beta', updatedAt: '2026-08-01T11:00:00Z', isFavorite: true }),
    ]
    renderSidebar()

    const links = Array.from(document.querySelectorAll('a[href^="/p/"]'))
    const alphaLink = links.find((l) => l.textContent?.includes('Alpha'))
    const betaLink = links.find((l) => l.textContent?.includes('Beta'))

    expect(alphaLink?.textContent).toContain(formatTime('2026-08-01T10:00:00Z'))
    expect(betaLink?.textContent).not.toContain(formatTime('2026-08-01T11:00:00Z'))
  })
})
