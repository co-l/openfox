// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockNavigate = vi.fn()
const mockDeleteSession = vi.fn(async () => true)
const mockEndSession = vi.fn(async (): Promise<'closing' | 'deleted' | 'error'> => 'closing')
const mockCancelEndSession = vi.fn(async () => undefined)

let sessions: Record<string, unknown>[] = []

function storeState() {
  return {
    sessions,
    currentSession: null,
    unreadSessionIds: [],
    sessionsWithPendingConfirmations: [],
    pendingPathConfirmations: [],
    sessionsHasMore: false,
    sessionsPaginationLoading: false,
    listSessions: vi.fn(),
    loadMoreSessions: vi.fn(),
    deleteSession: mockDeleteSession,
    endSession: mockEndSession,
    cancelEndSession: mockCancelEndSession,
    deleteAllSessions: vi.fn(),
    renameSession: vi.fn(),
  }
}

vi.mock('wouter', () => ({
  useLocation: () => [undefined, mockNavigate],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('../../stores/session', () => {
  const useSessionStore = (selector?: (state: ReturnType<typeof storeState>) => unknown) =>
    selector ? selector(storeState()) : storeState()
  Object.assign(useSessionStore, { getState: storeState, setState: vi.fn(), subscribe: vi.fn() })
  return { useSessionStore }
})

vi.mock('../../hooks/useCurrentProject', () => ({
  useCurrentProject: () => ({ id: 'project-1', name: 'Project', workdir: '/tmp/project' }),
}))

const { mockSettingValue } = vi.hoisted(() => ({ mockSettingValue: { current: 'end-of-session' } }))
vi.mock('../../hooks/useSetting', () => ({
  useSetting: () => ({ value: mockSettingValue.current, loading: false, error: null, setSetting: vi.fn() }),
}))

// Command list behind the availability check; each test decides what is installed.
const { mockCommands } = vi.hoisted(() => ({ mockCommands: { current: undefined as unknown } }))
vi.mock('../../hooks/useResource', () => ({
  useResource: () => ({ data: mockCommands.current, loading: false, refresh: vi.fn() }),
  useResourceWhen: () => ({ data: mockCommands.current, loading: false, refresh: vi.fn() }),
}))

vi.mock('../settings/ProjectSettingsModal', () => ({
  ProjectSettingsModal: () => null,
}))

// Menu items rendered inline so the flow can be driven without the real popover.
vi.mock('../shared/DropdownMenu', () => ({
  DropdownMenu: ({ items }: { items: { label: string; onClick?: (e?: unknown) => void }[] }) => (
    <div>
      {items.map((item) => (
        <button key={item.label} onClick={() => item.onClick?.()}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

import { Sidebar } from './Sidebar'

function session(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    projectId: 'project-1',
    workdir: '/tmp/project',
    mode: 'builder',
    phase: 'build',
    isRunning: false,
    isFavorite: false,
    title: 'Session one',
    createdAt: 'a',
    updatedAt: 'b',
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 3,
    ...over,
  }
}

describe('Sidebar closing flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('confirms before "Delete now" destroys a closing session', async () => {
    sessions = [session({ closingAt: '2026-09-13T00:00:00.000Z' })]
    render(<Sidebar projectId="project-1" />)

    await userEvent.click(screen.getByText('Delete now'))

    expect(mockDeleteSession).not.toHaveBeenCalled()
    expect(screen.getByText('This stops the closing routine and permanently deletes the session.')).toBeDefined()

    // The confirm dialog's own action button (the menu item is still in the tree).
    const confirmButtons = screen.getAllByRole('button', { name: 'Delete now' })
    expect(confirmButtons[confirmButtons.length - 1]!.className).not.toContain('accent-success')
    await userEvent.click(confirmButtons[confirmButtons.length - 1]!)

    expect(mockDeleteSession).toHaveBeenCalledWith('s1')
  })

  it('routes a normal delete through the closing routine', async () => {
    sessions = [session()]
    render(<Sidebar projectId="project-1" />)

    await userEvent.click(screen.getByText('Delete session', { selector: 'button' }))
    expect(mockEndSession).not.toHaveBeenCalled()

    expect(screen.getByText('Run Close later').closest('button')!.className).toContain('accent-success')

    await userEvent.click(screen.getByText('Run Close later'))

    expect(mockEndSession).toHaveBeenCalledWith('s1')
    expect(mockDeleteSession).not.toHaveBeenCalled()
  })

  it('deletes without the routine when "Skip Close now" is chosen', async () => {
    sessions = [session()]
    render(<Sidebar projectId="project-1" />)

    await userEvent.click(screen.getByText('Delete session', { selector: 'button' }))
    await userEvent.click(screen.getByText('Skip Close now'))

    expect(mockDeleteSession).toHaveBeenCalledWith('s1')
    expect(mockEndSession).not.toHaveBeenCalled()
  })

  it('offers the routine when the configured command can run', async () => {
    mockSettingValue.current = 'end-of-session'
    mockCommands.current = {
      defaults: [{ id: 'end-of-session', name: 'End of Session' }],
      userItems: [],
      projectItems: [],
    }
    sessions = [session()]
    render(<Sidebar projectId="project-1" />)

    await userEvent.click(screen.getByText('Delete session', { selector: 'button' }))

    expect(screen.getByText(/the \/end-of-session command runs first/)).toBeDefined()
    expect(screen.queryByText(/If it is available/)).toBeNull()
    expect(screen.queryByText(/Si elle est disponible/)).toBeNull()
    expect(screen.getByText('Run Close later')).toBeDefined()
    expect(screen.getByText('Skip Close now')).toBeDefined()
  })

  it('offers a plain delete when the routine is switched off', async () => {
    mockSettingValue.current = ''
    sessions = [session()]
    render(<Sidebar projectId="project-1" />)

    await userEvent.click(screen.getByText('Delete session', { selector: 'button' }))

    expect(screen.getByText('This session will be permanently deleted.')).toBeDefined()
    expect(screen.queryByText('Run Close later')).toBeNull()
    expect(screen.queryByText('Skip Close now')).toBeNull()
  })

  it('says so when the configured command is missing and offers no routine', async () => {
    mockSettingValue.current = 'ghost'
    mockCommands.current = { defaults: [], userItems: [], projectItems: [] }
    sessions = [session()]
    render(<Sidebar projectId="project-1" />)

    await userEvent.click(screen.getByText('Delete session', { selector: 'button' }))

    expect(screen.getByText(/End-of-session command "ghost" was not found/)).toBeDefined()
    expect(screen.queryByText('Run Close later')).toBeNull()
    expect(screen.queryByText('Skip Close now')).toBeNull()
  })

  it('says so when the configured command needs parameters', async () => {
    mockSettingValue.current = 'wrap'
    mockCommands.current = {
      defaults: [],
      userItems: [{ id: 'wrap', name: 'Wrap', paramNames: ['topic'] }],
      projectItems: [],
    }
    sessions = [session()]
    render(<Sidebar projectId="project-1" />)

    await userEvent.click(screen.getByText('Delete session', { selector: 'button' }))

    expect(screen.getByText(/needs parameters, so it cannot run automatically/)).toBeDefined()
    expect(screen.queryByText('Run Close later')).toBeNull()
  })

  it('deletes without the routine when the server refuses to close', async () => {
    mockSettingValue.current = 'end-of-session'
    mockCommands.current = {
      defaults: [{ id: 'end-of-session', name: 'End of Session' }],
      userItems: [],
      projectItems: [],
    }
    mockEndSession.mockResolvedValueOnce('error')
    sessions = [session()]
    render(<Sidebar projectId="project-1" />)

    await userEvent.click(screen.getByText('Delete session', { selector: 'button' }))
    await userEvent.click(screen.getByText('Run Close later'))

    expect(mockEndSession).toHaveBeenCalledWith('s1')
    expect(mockDeleteSession).not.toHaveBeenCalled()
    expect(screen.getByText(/could not run, so the session was left alone/)).toBeDefined()

    await userEvent.click(screen.getByText('Delete now'))
    expect(mockDeleteSession).toHaveBeenCalledWith('s1')
  })

  it('shows the closing badge while the routine is still running', () => {
    sessions = [session({ closingAt: '2026-09-13T00:00:00.000Z', isRunning: true })]
    render(<Sidebar projectId="project-1" />)

    expect(screen.getByText('closing')).toBeDefined()
    expect(screen.queryByText('done')).toBeNull()
  })

  it('shows the done badge once the closing routine has concluded', () => {
    sessions = [session({ closingAt: '2026-09-13T00:00:00.000Z', isRunning: false })]
    render(<Sidebar projectId="project-1" />)

    expect(screen.getByText('done')).toBeDefined()
    expect(screen.queryByText('closing')).toBeNull()
  })
})
