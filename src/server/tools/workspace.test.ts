import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetGitBranch = vi.fn()
const mockListWorkspaces = vi.fn()
const mockSwitchWorkspace = vi.fn()
const mockDeleteWorkspace = vi.fn()
const mockGetSession = vi.fn()
const mockGetProject = vi.fn()

vi.mock('../git/workspace.js', () => ({
  getGitBranch: (...args: unknown[]) => mockGetGitBranch(...args),
  listWorkspaces: (...args: unknown[]) => mockListWorkspaces(...args),
}))

import { workspaceTool } from './workspace.js'

function makeContext(overrides: Record<string, unknown> = {}) {
  const sessionManager = {
    getSession: mockGetSession,
    getProject: mockGetProject,
    switchWorkspace: mockSwitchWorkspace,
    deleteWorkspace: mockDeleteWorkspace,
  }
  return {
    workdir: '/tmp/project',
    sessionId: 'session-1',
    sessionManager: sessionManager as any,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('workspaceTool', () => {
  describe('switch', () => {
    it('switches to a named workspace', async () => {
      mockGetSession.mockReturnValue({ projectId: 'p1', workspace: null })
      mockSwitchWorkspace.mockResolvedValue({ workspace: '/workspaces/test/feat-x', workdir: '/tmp/project' })
      mockGetGitBranch.mockResolvedValue('main')

      const result = await workspaceTool.execute({ action: 'switch', target: 'feat-x' }, makeContext())
      expect(result.success).toBe(true)
      expect(result.output).toContain('feat-x')
      expect(result.output).toContain('main')
      expect(mockSwitchWorkspace).toHaveBeenCalledWith('session-1', 'feat-x', undefined)
    })

    it('switches to original', async () => {
      mockGetSession.mockReturnValue({ projectId: 'p1', workspace: '/workspaces/test/feat-x' })
      mockSwitchWorkspace.mockResolvedValue({ workspace: null, workdir: '/tmp/project' })
      mockGetGitBranch.mockResolvedValue('main')

      const result = await workspaceTool.execute({ action: 'switch', target: 'original' }, makeContext())
      expect(result.success).toBe(true)
      expect(result.output).toContain('"workspace": "original"')
      expect(mockSwitchWorkspace).toHaveBeenCalledWith('session-1', 'original', undefined)
    })

    it('switches with optional branch', async () => {
      mockGetSession.mockReturnValue({ projectId: 'p1', workspace: null })
      mockSwitchWorkspace.mockResolvedValue({ workspace: '/workspaces/test/feat-x', workdir: '/tmp/project' })
      mockGetGitBranch.mockResolvedValue('develop')

      const result = await workspaceTool.execute(
        { action: 'switch', target: 'feat-x', branch: 'develop' },
        makeContext(),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('develop')
      expect(mockSwitchWorkspace).toHaveBeenCalledWith('session-1', 'feat-x', 'develop')
    })

    it('returns error when target is missing', async () => {
      const result = await workspaceTool.execute({ action: 'switch' }, makeContext())
      expect(result.success).toBe(false)
    })
  })

  describe('list', () => {
    it('lists workspaces with active status when in original', async () => {
      mockGetSession.mockReturnValue({ projectId: 'p1', workspace: null, workdir: '/tmp/project' })
      mockGetProject.mockReturnValue({ name: 'test-project' })
      mockGetGitBranch.mockResolvedValue('develop')
      mockListWorkspaces.mockResolvedValue([{ name: 'my-exp', branch: 'feat-x', path: '/ws/my-exp' }])

      const result = await workspaceTool.execute({ action: 'list' }, makeContext())
      expect(result.success).toBe(true)
      const parsed = JSON.parse(result.output!)
      expect(parsed.workspaces).toHaveLength(2)
      expect(parsed.workspaces[0]).toEqual({ name: 'original', branch: 'develop', active: true })
      expect(parsed.workspaces[1]).toEqual({ name: 'my-exp', branch: 'feat-x', active: false })
    })

    it('lists workspaces with active status when in a named workspace', async () => {
      mockGetSession.mockReturnValue({ projectId: 'p1', workspace: '/workspaces/test/my-exp', workdir: '/tmp/project' })
      mockGetProject.mockReturnValue({ name: 'test-project' })
      mockGetGitBranch.mockResolvedValue('feat-x')
      mockListWorkspaces.mockResolvedValue([
        { name: 'my-exp', branch: 'feat-x', path: '/ws/my-exp' },
        { name: 'other', branch: 'main', path: '/ws/other' },
      ])

      const result = await workspaceTool.execute({ action: 'list' }, makeContext())
      expect(result.success).toBe(true)
      const parsed = JSON.parse(result.output!)
      expect(parsed.workspaces).toHaveLength(3)
      expect(parsed.workspaces[0]).toEqual({ name: 'original', branch: 'feat-x', active: false })
      expect(parsed.workspaces[1]).toEqual({ name: 'my-exp', branch: 'feat-x', active: true })
      expect(parsed.workspaces[2]).toEqual({ name: 'other', branch: 'main', active: false })
    })
  })

  describe('delete', () => {
    it('deletes a workspace', async () => {
      mockDeleteWorkspace.mockResolvedValue({ workspace: null, workdir: '/tmp/project' })

      const result = await workspaceTool.execute({ action: 'delete', target: 'feat-x' }, makeContext())
      expect(result.success).toBe(true)
      expect(result.output).toContain('feat-x')
      expect(mockDeleteWorkspace).toHaveBeenCalledWith('session-1', 'feat-x')
    })

    it('returns error when target is missing', async () => {
      const result = await workspaceTool.execute({ action: 'delete' }, makeContext())
      expect(result.success).toBe(false)
    })

    it('returns error when target is original', async () => {
      const result = await workspaceTool.execute({ action: 'delete', target: 'original' }, makeContext())
      expect(result.success).toBe(false)
    })
  })

  describe('invalid action', () => {
    it('returns error for unknown action', async () => {
      const result = await workspaceTool.execute({ action: 'fly' }, makeContext())
      expect(result.success).toBe(false)
    })
  })
})
