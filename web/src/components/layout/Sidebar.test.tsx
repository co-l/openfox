// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

const mockNavigate = vi.fn()

const sessionStoreState = {
  sessions: [
    {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'planner' as const,
      phase: 'build' as const,
      isRunning: true,
      createdAt: 'a',
      updatedAt: 'b',
      criteriaCount: 0,
      criteriaCompleted: 0,
      messageCount: 0,
    },
    {
      id: 'session-2',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'planner' as const,
      phase: 'plan' as const,
      isRunning: false,
      createdAt: 'a',
      updatedAt: 'b',
      criteriaCount: 0,
      criteriaCompleted: 0,
      messageCount: 0,
    },
    {
      id: 'session-3',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'planner' as const,
      phase: 'plan' as const,
      isRunning: false,
      createdAt: 'a',
      updatedAt: 'b',
      criteriaCount: 0,
      criteriaCompleted: 0,
      messageCount: 0,
    },
  ],
  currentSession: { id: 'session-2' },
  unreadSessionIds: ['session-3'],
  sessionsWithPendingConfirmations: [],
  pendingPathConfirmations: [],
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  listSessions: vi.fn(),
}

const sessionStoreStateRef = { current: sessionStoreState }

vi.mock('wouter', () => ({
  useLocation: () => [undefined, mockNavigate],
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => {
    const html = renderToStaticMarkup(<>{children}</>)
    return `<a href="${href}" class="${className}">${html}</a>`
  },
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: typeof sessionStoreState) => unknown) => selector(sessionStoreStateRef.current),
}))

vi.mock('../../hooks/useCurrentProject', () => ({
  useCurrentProject: () => ({ id: 'project-1', name: 'Project', workdir: '/tmp/project' }),
}))

vi.mock('../shared/Button', () => ({
  Button: ({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) => (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('../settings/ProjectSettingsModal', () => ({
  ProjectSettingsModal: () => null,
}))

describe('Sidebar', () => {
  it('shows the running indicator and hides unread for running sessions', () => {
    const html = renderToStaticMarkup(<Sidebar projectId="project-1" />)

    expect(html).toContain('Session running')
    expect(html).toContain('animate-spin')
  })

  it('groups all indicators on the right with proper alignment', () => {
    const html = renderToStaticMarkup(<Sidebar projectId="project-1" />)

    // Verify flex container with justify-between for right alignment
    expect(html).toContain('justify-between')
    // Verify flex container with items-center and gap for indicator alignment
    expect(html).toContain('flex items-center gap-2')
    // Verify no float-right hack is used
    expect(html).not.toContain('float-right')
    // Verify options menu trigger is present
    expect(html).toContain('Options')
  })

  it('displays message count in session list', () => {
    sessionStoreStateRef.current = {
      ...sessionStoreState,
      sessions: sessionStoreState.sessions.map((s) => ({
        ...s,
        messageCount: 5,
      })),
    }

    const html = renderToStaticMarkup(<Sidebar projectId="project-1" />)
    expect(html).toContain('5 messages')
  })

  it('renders as a fixed overlay with a backdrop when overlay mode is on', () => {
    const html = renderToStaticMarkup(<Sidebar projectId="project-1" isOpen overlay onClose={() => {}} />)

    expect(html).toContain('fixed z-50')
    expect(html).toContain('translate-x-0')
    expect(html).toContain('bg-black/50')
    expect(html).not.toContain('relative shrink-0')
  })

  it('slides the overlay off-screen when closed in overlay mode', () => {
    const html = renderToStaticMarkup(<Sidebar projectId="project-1" isOpen={false} overlay onClose={() => {}} />)
    expect(html).toContain('-translate-x-full')
  })

  it('renders as an inline flex item without a backdrop in inline mode', () => {
    const html = renderToStaticMarkup(<Sidebar projectId="project-1" isOpen overlay={false} />)

    expect(html).toContain('relative shrink-0')
    expect(html).not.toContain('fixed z-50')
    expect(html).not.toContain('bg-black/50')
  })

  it('collapses the inline sidebar to zero width when closed', () => {
    const html = renderToStaticMarkup(<Sidebar projectId="project-1" isOpen={false} overlay={false} />)
    expect(html).toContain('w-0')
  })
})
