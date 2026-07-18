import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockListBranches = vi.fn()
const mockGetGitBranch = vi.fn()
const mockSwitchWorkspace = vi.fn()
const mockGetSession = vi.fn()
const mockGetProject = vi.fn()

vi.mock('../git/workspace.js', () => ({
  listBranches: (...args: unknown[]) => mockListBranches(...args),
  getGitBranch: (...args: unknown[]) => mockGetGitBranch(...args),
}))

import { workspaceTool } from './workspace.js'

function makeContext(overrides: Record<string, unknown> = {}) {
  const sessionManager = {
    getSession: mockGetSession,
    getProject: mockGetProject,
    switchWorkspace: mockSwitchWorkspace,
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
  describe('list_branches', () => {
    it('returns branch list', async () => {
      mockGetSession.mockReturnValue({ projectId: 'p1' })
      mockGetProject.mockReturnValue({ workdir: '/tmp/project' })
      mockListBranches.mockResolvedValue([{ name: 'main', current: true }])

      const result = await workspaceTool.execute({ action: 'list_branches' }, makeContext())
      expect(result.success).toBe(true)
      expect(result.output).toContain('main')
    })

    it('returns error when session not found', async () => {
      mockGetSession.mockReturnValue(null)
      const result = await workspaceTool.execute({ action: 'list_branches' }, makeContext())
      expect(result.success).toBe(false)
    })
  })

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

  describe('status', () => {
    it('returns status when in workspace', async () => {
      mockGetSession.mockReturnValue({ projectId: 'p1', workspace: '/workspaces/test/feat-x', workdir: '/tmp/project' })
      mockGetGitBranch.mockResolvedValue('develop')

      const result = await workspaceTool.execute({ action: 'status' }, makeContext())
      expect(result.success).toBe(true)
      expect(result.output).toContain('"workspace": "feat-x"')
      expect(result.output).toContain('"branch": "develop"')
    })

    it('returns status when in original', async () => {
      mockGetSession.mockReturnValue({ projectId: 'p1', workspace: null, workdir: '/tmp/project' })
      mockGetGitBranch.mockResolvedValue('main')

      const result = await workspaceTool.execute({ action: 'status' }, makeContext())
      expect(result.success).toBe(true)
      expect(result.output).toContain('"workspace": "original"')
      expect(result.output).toContain('"branch": "main"')
    })
  })

  describe('invalid action', () => {
    it('returns error for unknown action', async () => {
      const result = await workspaceTool.execute({ action: 'fly' }, makeContext())
      expect(result.success).toBe(false)
    })
  })
})
