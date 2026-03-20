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
    },
  ],
  currentSession: { id: 'session-2' },
  unreadSessionIds: ['session-1'],
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  listSessions: vi.fn(),
}

const projectStoreState = {
  currentProject: { id: 'project-1', name: 'Project', workdir: '/tmp/project' },
}

vi.mock('wouter', () => ({
  useLocation: () => [undefined, mockNavigate],
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: typeof sessionStoreState) => unknown) => selector(sessionStoreState),
}))

vi.mock('../../stores/project', () => ({
  useProjectStore: (selector: (state: typeof projectStoreState) => unknown) => selector(projectStoreState),
}))

vi.mock('../shared/Button', () => ({
  Button: ({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) => (
    <button className={className} onClick={onClick}>{children}</button>
  ),
}))

vi.mock('../settings/ProjectSettingsModal', () => ({
  ProjectSettingsModal: () => null,
}))

describe('Sidebar', () => {
  it('shows the running indicator and hides unread for running sessions', () => {
    const html = renderToStaticMarkup(<Sidebar projectId="project-1" />)

    expect(html).toContain('Session running')
    expect(html).not.toContain('Unread activity')
    expect(html).toContain('animate-spin')
  })
})
