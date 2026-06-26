import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { McpManager } from '../mcp/manager.js'
import { setMcpManagerForTools, resetMcpManagerForTools } from './mcp-config.js'

const mockSetToolEnabled = vi.fn().mockResolvedValue(undefined)

const mockManager = {
  getAllServers: vi.fn().mockReturnValue([
    {
      name: 'filesystem',
      config: { transport: 'stdio', command: 'npx' },
      status: 'connected',
      tools: [
        { name: 'read_file', description: 'Read a file', inputSchema: {}, enabled: true, estimatedTokens: 10 },
        { name: 'write_file', description: 'Write a file', inputSchema: {}, enabled: false, estimatedTokens: 15 },
      ],
      estimatedTokens: 10,
    },
  ]),
  addServer: vi.fn().mockResolvedValue(undefined),
  removeServer: vi.fn(),
  setToolEnabled: mockSetToolEnabled,
  getToolDefinitions: vi.fn().mockReturnValue([]),
  getServer: vi.fn().mockReturnValue({
    name: 'filesystem',
    config: { transport: 'stdio', command: 'npx' },
    status: 'connected',
    tools: [{ name: 'read_file', description: 'Read a file', inputSchema: {}, enabled: true, estimatedTokens: 10 }],
    estimatedTokens: 10,
  }),
} as unknown as McpManager

const mockLoadGlobalConfig = vi.fn().mockResolvedValue({
  mcpServers: {
    filesystem: { transport: 'stdio', command: 'npx' },
  },
})
const mockSaveGlobalConfig = vi.fn().mockResolvedValue(undefined)
const mockCreateMcpTools = vi.fn().mockReturnValue([])
const mockSetMcpTools = vi.fn()

vi.mock('../../cli/config.js', () => ({
  loadGlobalConfig: (...args: unknown[]) => mockLoadGlobalConfig(...args),
  saveGlobalConfig: (...args: unknown[]) => mockSaveGlobalConfig(...args),
}))

vi.mock('../mcp/tool-adapter.js', () => ({
  createMcpTools: (...args: unknown[]) => mockCreateMcpTools(...args),
}))

vi.mock('./index.js', () => ({
  setMcpTools: (...args: unknown[]) => mockSetMcpTools(...args),
  createToolRegistry: vi.fn(() => ({ definitions: [] })),
}))

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

const mockApplyDynamicContext = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../chat/dynamic-context.js', () => ({
  applyDynamicContext: mockApplyDynamicContext,
}))

function mockSessionManager() {
  return {} as any
}

describe('mcpConfigTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMcpManagerForTools()
  })

  describe('action: list', () => {
    it('should return formatted server list when servers exist', async () => {
      setMcpManagerForTools(mockManager)

      const { mcpConfigTool } = await import('./mcp-config.js')

      const result = await mcpConfigTool.execute(
        { action: 'list' },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
      expect(result.output).toContain('filesystem')
      expect(result.output).toContain('stdio')
      expect(result.output).toContain('connected')
      expect(result.output).toContain('read_file')
      expect(result.output).toContain('2 tools')
    })

    it('should report no servers when none configured', async () => {
      setMcpManagerForTools({
        ...mockManager,
        getAllServers: vi.fn().mockReturnValue([]),
      } as unknown as McpManager)

      const { mcpConfigTool } = await import('./mcp-config.js')

      const result = await mcpConfigTool.execute(
        { action: 'list' },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
      expect(result.output).toBe('No MCP servers configured.')
    })

    it('should return error when no manager is set', async () => {
      const { mcpConfigTool } = await import('./mcp-config.js')

      const result = await mcpConfigTool.execute(
        { action: 'list' },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('MCP manager not available')
    })
  })

  describe('action: add', () => {
    it('should add a stdio server and persist config', async () => {
      setMcpManagerForTools(mockManager)

      const { mcpConfigTool } = await import('./mcp-config.js')

      const result = await mcpConfigTool.execute(
        {
          action: 'add',
          name: 'new-server',
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: { API_KEY: 'abc' },
        },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
      expect(result.output).toContain('new-server')
      expect(mockManager.addServer).toHaveBeenCalledWith(
        'new-server',
        expect.objectContaining({
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: { API_KEY: 'abc' },
        }),
      )
      expect(mockLoadGlobalConfig).toHaveBeenCalled()
      expect(mockSaveGlobalConfig).toHaveBeenCalled()
      expect(mockCreateMcpTools).toHaveBeenCalled()
      expect(mockSetMcpTools).toHaveBeenCalled()
      expect(mockApplyDynamicContext).toHaveBeenCalledWith(expect.any(Object), 's1')
    })

    it('should add an HTTP server with headers', async () => {
      setMcpManagerForTools(mockManager)

      const { mcpConfigTool } = await import('./mcp-config.js')

      const result = await mcpConfigTool.execute(
        {
          action: 'add',
          name: 'context7',
          transport: 'http',
          url: 'https://mcp.context7.com/mcp',
          headers: { CONTEXT7_API_KEY: 'sk-123' },
        },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
      expect(mockManager.addServer).toHaveBeenCalledWith(
        'context7',
        expect.objectContaining({
          transport: 'http',
          url: 'https://mcp.context7.com/mcp',
          headers: { CONTEXT7_API_KEY: 'sk-123' },
        }),
      )
    })

    it('should require name and command for stdio', async () => {
      setMcpManagerForTools(mockManager)

      const { mcpConfigTool } = await import('./mcp-config.js')

      const noName = await mcpConfigTool.execute(
        { action: 'add', command: 'node' },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )
      expect(noName.success).toBe(false)
      expect(noName.error).toContain('name')

      const noCmd = await mcpConfigTool.execute(
        { action: 'add', name: 'x' },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )
      expect(noCmd.success).toBe(false)
      expect(noCmd.error).toContain('stdio')

      const noUrl = await mcpConfigTool.execute(
        { action: 'add', name: 'x', transport: 'http' },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )
      expect(noUrl.success).toBe(false)
      expect(noUrl.error).toContain('url')
    })
  })

  describe('action: remove', () => {
    it('should remove a server and persist config', async () => {
      setMcpManagerForTools(mockManager)

      const { mcpConfigTool } = await import('./mcp-config.js')

      const result = await mcpConfigTool.execute(
        { action: 'remove', name: 'filesystem' },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
      expect(result.output).toContain('filesystem')
      expect(mockManager.removeServer).toHaveBeenCalledWith('filesystem')
      expect(mockSaveGlobalConfig).toHaveBeenCalled()
      expect(mockApplyDynamicContext).toHaveBeenCalledWith(expect.any(Object), 's1')
    })

    it('should require name', async () => {
      setMcpManagerForTools(mockManager)

      const { mcpConfigTool } = await import('./mcp-config.js')

      const result = await mcpConfigTool.execute(
        { action: 'remove' },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('name')
    })
  })

  describe('action: toggle-tool', () => {
    it('should toggle a tool and persist config', async () => {
      setMcpManagerForTools(mockManager)

      const { mcpConfigTool } = await import('./mcp-config.js')

      const result = await mcpConfigTool.execute(
        { action: 'toggle-tool', name: 'filesystem', toolName: 'read_file', enabled: false },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
      expect(mockSetToolEnabled).toHaveBeenCalledWith('filesystem', 'read_file', false)
      expect(mockSaveGlobalConfig).toHaveBeenCalled()
      expect(mockCreateMcpTools).toHaveBeenCalled()
      expect(mockSetMcpTools).toHaveBeenCalled()
      expect(mockApplyDynamicContext).toHaveBeenCalledWith(expect.any(Object), 's1')
    })

    it('should require name, toolName, and enabled', async () => {
      setMcpManagerForTools(mockManager)

      const { mcpConfigTool } = await import('./mcp-config.js')

      const noName = await mcpConfigTool.execute(
        { action: 'toggle-tool', toolName: 'x', enabled: true },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )
      expect(noName.success).toBe(false)

      const noTool = await mcpConfigTool.execute(
        { action: 'toggle-tool', name: 'x', enabled: true },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )
      expect(noTool.success).toBe(false)

      const noEnabled = await mcpConfigTool.execute(
        { action: 'toggle-tool', name: 'x', toolName: 'y' },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )
      expect(noEnabled.success).toBe(false)
    })
  })

  describe('invalid action', () => {
    it('should reject unknown actions', async () => {
      setMcpManagerForTools(mockManager)

      const { mcpConfigTool } = await import('./mcp-config.js')

      const result = await mcpConfigTool.execute(
        { action: 'reboot' },
        { workdir: '/tmp', sessionId: 's1', sessionManager: mockSessionManager() },
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('reboot')
    })
  })
})
