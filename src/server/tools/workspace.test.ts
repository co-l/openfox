import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetGitBranch = vi.fn()
const mockListWorkspaces = vi.fn()
const mockSwitchWorkspace = vi.fn()
const mockDeleteWorkspace = vi.fn()
const mockGetSession = vi.fn()
const mockGetProject = vi.fn()
const mockRegisterPathConfirmation = vi.fn()

vi.mock('../git/workspace.js', () => ({
  getGitBranch: (...args: unknown[]) => mockGetGitBranch(...args),
  listWorkspaces: (...args: unknown[]) => mockListWorkspaces(...args),
}))

vi.mock('./path-security.js', () => ({
  registerPathConfirmation: (...args: unknown[]) => mockRegisterPathConfirmation(...args),
  PathAccessDeniedError: class extends Error {
    paths = []
    tool = ''
    reason = 'outside_workdir'
    constructor() {
      super('denied')
      this.name = 'PathAccessDeniedError'
    }
  },
}))

vi.mock('../db/settings.js', () => ({
  getSetting: (key: string) => {
    if (key === 'tools.confirmOnWorkspaceActions') return 'true'
    return null
  },
  SETTINGS_KEYS: {
    CONFIRM_ON_WORKSPACE_ACTIONS: 'tools.confirmOnWorkspaceActions',
  },
}))

import { workspaceTool } from './workspace.js'

function makeContext(overrides: Record<string, unknown> = {}) {
  const sessionManager = {
    getSession: mockGetSession,
    getProject: mockGetProject,
    getEffectiveWorkdir: vi.fn((id: string) => {
      const session = mockGetSession(id)
      return session?.workspace ?? '/tmp/project'
    }),
    switchWorkspace: mockSwitchWorkspace,
    deleteWorkspace: mockDeleteWorkspace,
  }
  return {
    workdir: '/tmp/project',
    sessionId: 'session-1',
    sessionManager: sessionManager as any,
    onEvent: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('workspaceTool', () => {
  describe('switch', () => {
    it('switches to a named workspace after user confirmation', async () => {
      mockRegisterPathConfirmation.mockResolvedValue(true)
      mockGetGitBranch.mockResolvedValue('main')
      mockSwitchWorkspace.mockResolvedValue({ workspace: '/workspaces/test/feat-x', workdir: '/tmp/project' })

      const result = await workspaceTool.execute({ action: 'switch', target: 'feat-x' }, makeContext())
      expect(result.success).toBe(true)
      expect(result.output).toContain('feat-x')
      expect(result.output).toContain('main')
      expect(mockSwitchWorkspace).toHaveBeenCalledWith('session-1', 'feat-x', undefined, undefined)
    })

    it('switches to original after user confirmation', async () => {
      mockRegisterPathConfirmation.mockResolvedValue(true)
      mockGetGitBranch.mockResolvedValue('main')
      mockSwitchWorkspace.mockResolvedValue({ workspace: null, workdir: '/tmp/project' })

      const result = await workspaceTool.execute({ action: 'switch', target: 'original' }, makeContext())
      expect(result.success).toBe(true)
      expect(result.output).toContain('"workspace": "original"')
      expect(mockSwitchWorkspace).toHaveBeenCalledWith('session-1', 'original', undefined, undefined)
    })

    it('switches with optional branch after user confirmation', async () => {
      mockRegisterPathConfirmation.mockResolvedValue(true)
      mockGetGitBranch.mockResolvedValue('develop')
      mockSwitchWorkspace.mockResolvedValue({ workspace: '/workspaces/test/feat-x', workdir: '/tmp/project' })

      const result = await workspaceTool.execute(
        { action: 'switch', target: 'feat-x', branch: 'develop' },
        makeContext(),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('develop')
      expect(mockSwitchWorkspace).toHaveBeenCalledWith('session-1', 'feat-x', 'develop', undefined)
    })

    it('changes branch on the current workspace without recreating', async () => {
      mockGetSession.mockReturnValue({ projectId: 'p1', workspace: '/workspaces/test/feat-x', workdir: '/tmp/project' })
      mockRegisterPathConfirmation.mockResolvedValue(true)
      mockGetGitBranch.mockResolvedValue('toto')
      mockSwitchWorkspace.mockResolvedValue({ workspace: '/workspaces/test/feat-x', workdir: '/tmp/project' })

      const result = await workspaceTool.execute({ action: 'switch', target: 'feat-x', branch: 'toto' }, makeContext())
      expect(result.success).toBe(true)
      expect(result.output).toContain('toto')
      expect(mockSwitchWorkspace).toHaveBeenCalledWith('session-1', 'feat-x', 'toto', undefined)
    })

    it('returns error when user denies switch', async () => {
      mockRegisterPathConfirmation.mockResolvedValue(false)

      const result = await workspaceTool.execute({ action: 'switch', target: 'feat-x' }, makeContext())
      expect(result.success).toBe(false)
      expect(result.error).toContain('denied')
      expect(mockSwitchWorkspace).not.toHaveBeenCalled()
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
    it('deletes a workspace after user confirmation', async () => {
      mockRegisterPathConfirmation.mockResolvedValue(true)
      mockDeleteWorkspace.mockResolvedValue({ workspace: null, workdir: '/tmp/project' })

      const result = await workspaceTool.execute({ action: 'delete', target: 'feat-x' }, makeContext())
      expect(result.success).toBe(true)
      expect(result.output).toContain('feat-x')
      expect(mockDeleteWorkspace).toHaveBeenCalledWith('session-1', 'feat-x')
    })

    it('returns error when user denies delete', async () => {
      mockRegisterPathConfirmation.mockResolvedValue(false)

      const result = await workspaceTool.execute({ action: 'delete', target: 'feat-x' }, makeContext())
      expect(result.success).toBe(false)
      expect(result.error).toContain('denied')
      expect(mockDeleteWorkspace).not.toHaveBeenCalled()
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
