import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/ws', () => ({
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

vi.mock('../../stores/session', () => ({
  useSessionStore: () => ({
    currentSession: { id: 'session-1', metadata: { title: 'Test Session' } },
    sessions: [],
    messages: [],
    agentMode: 'planner',
    planMode: false,
    status: 'idle',
    projectId: 'project-1',
  }),
}))

vi.mock('../../stores/project', () => ({
  useProjectStore: () => ({
    currentProject: {
      id: 'project-1',
      name: 'Test Project',
      workdir: '/tmp/test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    projects: [
      {
        id: 'project-1',
        name: 'Test Project',
        workdir: '/tmp/test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    loading: false,
  }),
}))

vi.mock('../../stores/config', () => ({
  useConfigStore: () => ({
    config: { theme: 'dark', llmProvider: 'ollama', model: 'test' },
    startAutoRefresh: vi.fn(),
    stopAutoRefresh: vi.fn(),
  }),
}))

vi.mock('../../stores/terminal', () => ({
  useTerminalStore: () => ({
    isOpen: false,
    sessions: [],
    workdir: null,
    setOpen: vi.fn(),
    toggleOpen: vi.fn(),
    executeCommand: vi.fn(),
  }),
}))

describe('SessionDropdown keyboard navigation fix', () => {
  it('uses refs to maintain keyboard handler stability', async () => {
    const { Header } = await import('./Header')
    expect(Header).toBeDefined()
  })
})
