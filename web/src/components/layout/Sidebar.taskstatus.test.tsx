// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { clearCache } from '../../lib/resourceCache'
import { boardResource } from '../../lib/resources'
import { Sidebar } from './Sidebar'

const mockNavigate = vi.fn()

const sessionStoreState = {
  sessions: [
    {
      id: 'sess-linked',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'planner' as const,
      phase: 'build' as const,
      isRunning: false,
      createdAt: 'a',
      updatedAt: 'b',
      criteriaCount: 0,
      criteriaCompleted: 0,
      messageCount: 2,
    },
    {
      id: 'sess-free',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'planner' as const,
      phase: 'plan' as const,
      isRunning: false,
      createdAt: 'a',
      updatedAt: 'b',
      criteriaCount: 0,
      criteriaCompleted: 0,
      messageCount: 1,
    },
  ],
  currentSession: null,
  unreadSessionIds: [],
  sessionsWithPendingConfirmations: [],
  pendingPathConfirmations: [],
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  listSessions: vi.fn(),
}

vi.mock('wouter', () => ({
  useLocation: () => [undefined, mockNavigate],
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => {
    const html = renderToStaticMarkup(<>{children}</>)
    return `<a href="${href}" class="${className}">${html}</a>`
  },
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: typeof sessionStoreState) => unknown) => selector(sessionStoreState),
}))

vi.mock('../../hooks/useCurrentProject', () => ({
  useCurrentProject: () => ({ id: 'project-1', name: 'Project', workdir: '/tmp/project' }),
}))

vi.mock('../settings/ProjectSettingsModal', () => ({
  ProjectSettingsModal: () => null,
}))

describe('Sidebar task-status chip', () => {
  beforeEach(() => {
    clearCache()
    boardResource.write(
      {
        tasks: [],
        settings: { slotLimit: 1, queuePaused: false },
        counts: { open: 0, backlog: 0, todo: 0, inProgress: 0, running: 0, queued: 0, review: 0, done: 0 },
        gates: [],
        sessionStatus: { 'sess-linked': 'in_progress' },
      },
      'project-1',
    )
  })

  it('renders a status square on the card of a board-linked session only', () => {
    const html = renderToStaticMarkup(<Sidebar projectId="project-1" />)
    // The Link mock escapes inner markup; match the escaped attribute form.
    expect(html).toContain('task-status-chip')
    expect(html).toContain('data-status=&quot;in_progress&quot;')
    // The monospace label uses the column color (amber = In Progress).
    expect(html).toContain('#f59e0b')
    expect(html).toContain('font-mono')
    // Unlinked sessions render no extra chip: exactly one chip total.
    expect(html.match(/task-status-chip/g)?.length ?? 0).toBe(1)
  })

  it('renders nothing when the board has no session map', () => {
    clearCache()
    boardResource.write(
      {
        tasks: [],
        settings: { slotLimit: 1, queuePaused: false },
        counts: { open: 0, backlog: 0, todo: 0, inProgress: 0, running: 0, queued: 0, review: 0, done: 0 },
        gates: [],
      },
      'project-1',
    )
    const html = renderToStaticMarkup(<Sidebar projectId="project-1" />)
    expect(html).not.toContain('task-status-chip')
  })
})
