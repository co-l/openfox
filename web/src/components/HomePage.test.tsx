import { describe, expect, it, vi } from 'vitest'

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

vi.mock('../stores/session', () => ({
  useSessionStore: () => ({
    sessions: [],
    listSessions: vi.fn(),
    connectionStatus: 'connected',
  }),
}))

vi.mock('../stores/project', () => ({
  useProjectStore: () => ({
    projects: [
      { id: 'p1', name: 'Project Alpha', workdir: '/tmp/alpha', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      { id: 'p2', name: 'Project Beta', workdir: '/tmp/beta', createdAt: '2024-01-02', updatedAt: '2024-01-02' },
    ],
    loading: false,
    listProjects: vi.fn(),
    deleteProject: vi.fn(),
  }),
}))

describe('HomePage', () => {
  it('exports the component', async () => {
    const { HomePage } = await import('./HomePage')
    expect(HomePage).toBeDefined()
  })
})
