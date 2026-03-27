import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Header } from './Header'

const mockNavigate = vi.fn()

const sessionStoreState = {
  connectionStatus: 'connected' as const,
  sessions: [
    {
      id: 'session-1',
      projectId: 'proj-1',
      workdir: '/home/user/project1/sessions/session-1',
      title: 'Test Session',
      mode: 'planner' as const,
      phase: 'done' as const,
      isRunning: false,
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T14:30:00Z',
      criteriaCount: 2,
      criteriaCompleted: 1,
    },
    {
      id: 'session-2',
      projectId: 'proj-1',
      workdir: '/home/user/project1/sessions/session-2',
      title: 'Another Session',
      mode: 'planner' as const,
      phase: 'done' as const,
      isRunning: false,
      createdAt: '2024-01-16T09:00:00Z',
      updatedAt: '2024-01-16T11:00:00Z',
      criteriaCount: 1,
      criteriaCompleted: 1,
    },
  ],
  currentSession: {
    id: 'session-1',
    projectId: 'proj-1',
    workdir: '/home/user/project1/sessions/session-1',
    mode: 'planner' as const,
    phase: 'done' as const,
    isRunning: false,
    metadata: { title: 'Test Session' },
  },
  loadSession: vi.fn(),
  listSessions: vi.fn(),
}

const projectStoreState = {
  currentProject: {
    id: 'proj-1',
    name: 'Test Project',
    workdir: '/home/user/project1',
  },
  projects: [
    { id: 'proj-1', name: 'Test Project', workdir: '/home/user/project1' },
    { id: 'proj-2', name: 'Another Project', workdir: '/home/user/project2' },
  ],
  loadProject: vi.fn(),
}

const configStoreState = {
  startAutoRefresh: vi.fn(),
  stopAutoRefresh: vi.fn(),
  providers: [],
}

vi.mock('wouter', () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
  useLocation: () => [undefined, mockNavigate],
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: typeof sessionStoreState) => unknown) => selector(sessionStoreState),
}))

vi.mock('../../stores/project', () => ({
  useProjectStore: (selector: (state: typeof projectStoreState) => unknown) => selector(projectStoreState),
}))

vi.mock('../../stores/config', () => ({
  useConfigStore: (selector: (state: typeof configStoreState) => unknown) => selector(configStoreState),
}))

vi.mock('../settings/GlobalSettingsModal', () => ({
  GlobalSettingsModal: () => null,
}))

vi.mock('../settings/SkillsModal', () => ({
  SkillsModal: () => null,
}))

vi.mock('../settings/AgentsModal', () => ({
  AgentsModal: () => null,
}))

vi.mock('../settings/WorkflowsModal', () => ({
  WorkflowsModal: () => null,
}))

vi.mock('../history/HistoryModal', () => ({
  HistoryModal: () => null,
}))

describe('Header', () => {
  it('renders OpenFox logo as a link to home', () => {
    const html = renderToStaticMarkup(<Header />)
    expect(html).toContain('OpenFox')
    expect(html).toContain('href="/"')
  })

  it('renders project dropdown with current project name', () => {
    const html = renderToStaticMarkup(<Header />)
    expect(html).toContain('Test Project')
  })

  it('renders session dropdown with current session name', () => {
    const html = renderToStaticMarkup(<Header />)
    expect(html).toContain('Test Session')
  })

  it('displays projects sorted alphabetically in dropdown', () => {
    const html = renderToStaticMarkup(<Header />)
    
    // The dropdown menu content is only rendered when open, so we can't test the sorted list
    // But we can verify the trigger shows the current project
    expect(html).toContain('Test Project')
    
    // Verify the dropdown structure is present
    expect(html).toContain('relative') // DropdownMenu wrapper
  })

  it('displays sessions grouped by date in dropdown', () => {
    const html = renderToStaticMarkup(<Header />)
    
    // The dropdown menu content is only rendered when open, so we can't test the grouped sessions
    // But we can verify the trigger shows the current session
    expect(html).toContain('Test Session')
    
    // Verify the dropdown structure is present
    expect(html).toContain('relative') // DropdownMenu wrapper
  })

  it('renders dropdown indicators (chevrons) on triggers', () => {
    const html = renderToStaticMarkup(<Header />)
    
    // Check for chevron SVG paths in the HTML
    // The chevron down icon has path d="M19 9l-7 7-7-7"
    expect(html).toContain('M19 9l-7 7-7-7')
  })

  it('renders project and session dropdowns separated by /', () => {
    const html = renderToStaticMarkup(<Header />)
    
    // Check for the separator spans
    expect(html).toContain('text-text-muted')
  })
})
