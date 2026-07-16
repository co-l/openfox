import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockListBranches = vi.fn()
const mockCreateSessionWorktree = vi.fn()
const mockAttachSessionWorktree = vi.fn()
const mockCloseSessionWorktree = vi.fn()
const mockGetSession = vi.fn()
const mockGetProject = vi.fn()

vi.mock('../git/worktree.js', () => ({
  listBranches: (...args: unknown[]) => mockListBranches(...args),
}))

import { worktreeTool } from './worktree.js'

function makeContext(overrides: Record<string, unknown> = {}) {
  const sessionManager = {
    getSession: mockGetSession,
    getProject: mockGetProject,
    createSessionWorktree: mockCreateSessionWorktree,
    attachSessionWorktree: mockAttachSessionWorktree,
    closeSessionWorktree: mockCloseSessionWorktree,
  }
  return {
    workdir: '/tmp/project',
    sessionId: 'session-1',
    sessionManager: sessionManager as any,
    ...overrides,
  }
}

describe('worktree tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockReturnValue({
      id: 'session-1',
      projectId: 'proj-1',
      workdir: '/tmp/project',
      worktree: null,
    })
    mockGetProject.mockReturnValue({
      id: 'proj-1',
      name: 'Test Project',
      workdir: '/tmp/project',
    })
  })

  describe('list_branches', () => {
    it('returns list of branches', async () => {
      mockListBranches.mockResolvedValue([
        { name: 'main', current: true },
        { name: 'develop', current: false },
      ])

      const result = await worktreeTool.execute({ action: 'list_branches' }, makeContext())

      expect(result.success).toBe(true)
      const parsed = JSON.parse(result.output ?? '{}') as { branches: Array<{ name: string; current: boolean }> }
      expect(parsed.branches).toHaveLength(2)
      expect(parsed.branches[0]!.name).toBe('main')
      expect(parsed.branches[0]!.current).toBe(true)
    })

    it('returns error when project not found', async () => {
      mockGetProject.mockReturnValue(null)

      const result = await worktreeTool.execute({ action: 'list_branches' }, makeContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Project not found')
    })
  })

  describe('create', () => {
    it('creates a worktree and attaches session', async () => {
      mockCreateSessionWorktree.mockResolvedValue({
        id: 'session-1',
        projectId: 'proj-1',
        workdir: '/tmp/project',
        worktree: '/tmp/project/worktrees/my-feature',
      })

      const result = await worktreeTool.execute({ action: 'create', name: 'my-feature' }, makeContext())

      expect(result.success).toBe(true)
      expect(mockCreateSessionWorktree).toHaveBeenCalledWith('session-1', 'my-feature')
      const parsed = JSON.parse(result.output ?? '{}') as { worktree: string; branch: string }
      expect(parsed.worktree).toContain('my-feature')
      expect(parsed.branch).toBe('my-feature')
    })

    it('requires name parameter', async () => {
      const result = await worktreeTool.execute({ action: 'create' }, makeContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('name')
    })

    it('handles session manager errors', async () => {
      mockCreateSessionWorktree.mockRejectedValue(new Error('Session already has a worktree'))

      const result = await worktreeTool.execute({ action: 'create', name: 'another' }, makeContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Session already has a worktree')
    })
  })

  describe('attach', () => {
    it('attaches to existing worktree', async () => {
      mockAttachSessionWorktree.mockResolvedValue({
        id: 'session-1',
        projectId: 'proj-1',
        workdir: '/tmp/project',
        worktree: '/tmp/project/worktrees/existing',
      })

      const result = await worktreeTool.execute(
        { action: 'attach', path: '/tmp/project/worktrees/existing' },
        makeContext(),
      )

      expect(result.success).toBe(true)
      expect(mockAttachSessionWorktree).toHaveBeenCalledWith('session-1', '/tmp/project/worktrees/existing')
      const parsed = JSON.parse(result.output ?? '{}') as { worktree: string }
      expect(parsed.worktree).toContain('existing')
    })

    it('requires path parameter', async () => {
      const result = await worktreeTool.execute({ action: 'attach' }, makeContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('path')
    })
  })

  describe('close', () => {
    it('closes the current worktree', async () => {
      mockGetSession.mockReturnValue({
        id: 'session-1',
        projectId: 'proj-1',
        workdir: '/tmp/project',
        worktree: '/tmp/project/worktrees/my-feature',
      })
      mockCloseSessionWorktree.mockResolvedValue({
        id: 'session-1',
        projectId: 'proj-1',
        workdir: '/tmp/project',
        worktree: null,
      })

      const result = await worktreeTool.execute({ action: 'close' }, makeContext())

      expect(result.success).toBe(true)
      expect(mockCloseSessionWorktree).toHaveBeenCalledWith('session-1')
      const parsed = JSON.parse(result.output ?? '{}') as { worktree: string | null }
      expect(parsed.worktree).toBeNull()
    })
  })

  describe('status', () => {
    it('returns current worktree status when active', async () => {
      mockGetSession.mockReturnValue({
        id: 'session-1',
        projectId: 'proj-1',
        workdir: '/tmp/project',
        worktree: '/tmp/project/worktrees/my-feature',
      })

      const result = await worktreeTool.execute({ action: 'status' }, makeContext())

      expect(result.success).toBe(true)
      const parsed = JSON.parse(result.output ?? '{}') as { active: boolean; worktree: string }
      expect(parsed.active).toBe(true)
      expect(parsed.worktree).toContain('my-feature')
    })

    it('returns inactive status when no worktree', async () => {
      const result = await worktreeTool.execute({ action: 'status' }, makeContext())

      expect(result.success).toBe(true)
      const parsed = JSON.parse(result.output ?? '{}') as { active: boolean }
      expect(parsed.active).toBe(false)
    })
  })

  describe('validation', () => {
    it('rejects unknown action', async () => {
      const result = await worktreeTool.execute({ action: 'unknown' }, makeContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid action')
    })

    it('rejects missing action', async () => {
      const result = await worktreeTool.execute({}, makeContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid action')
    })
  })
})
