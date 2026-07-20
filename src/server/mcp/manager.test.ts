import { describe, expect, it, vi, beforeEach } from 'vitest'
import { McpManager } from './manager.js'
import { createMcpTools } from './tool-adapter.js'

// Mock the MCP SDK Client
const mockClientInstance = {
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  listTools: vi.fn().mockResolvedValue({
    tools: [
      {
        name: 'get_weather',
        description: 'Get weather',
        inputSchema: { type: 'object', properties: { location: { type: 'string' } } },
      },
      {
        name: 'write_file',
        description: 'Write file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ],
  }),
  callTool: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Sunny, 72°F' }],
    isError: false,
  }),
}

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function () {
    return mockClientInstance
  }),
}))

const mockTransportInstance: {
  start: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  onmessage?: ((message: unknown) => void) | undefined
} = {
  start: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(function () {
    return mockTransportInstance
  }),
}))

const mockHttpTransportInstance: {
  start: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  onmessage?: ((message: unknown) => void) | undefined
} = {
  start: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(function () {
    return mockHttpTransportInstance
  }),
}))

describe('McpManager', () => {
  let manager: McpManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new McpManager()
  })

  describe('addServer', () => {
    it('should connect to a stdio server and discover tools', async () => {
      await manager.addServer('test-server', {
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      })

      const server = manager.getServer('test-server')
      expect(server).toBeDefined()
      expect(server!.status).toBe('connected')
      expect(server!.tools).toHaveLength(2)
      expect(server!.tools[0]!.name).toBe('get_weather')
      expect(server!.tools[1]!.name).toBe('write_file')
    })

    it('should reject duplicate server names', async () => {
      await manager.addServer('test', { transport: 'stdio', command: 'node' })
      await expect(manager.addServer('test', { transport: 'stdio', command: 'node' })).rejects.toThrow('already exists')
    })

    it('should connect to an HTTP server and discover tools', async () => {
      await manager.addServer('http-server', {
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: { 'X-API-Key': 'secret123' },
      })

      const server = manager.getServer('http-server')
      expect(server).toBeDefined()
      expect(server!.status).toBe('connected')
      expect(server!.tools).toHaveLength(2)
      expect(server!.tools[0]!.name).toBe('get_weather')

      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL('https://mcp.example.com/mcp'),
        expect.objectContaining({
          requestInit: expect.objectContaining({
            headers: { 'X-API-Key': 'secret123' },
          }),
        }),
      )
    })

    it('should set server to error state when HTTP transport is missing url', async () => {
      await manager.addServer('bad-http', {
        transport: 'http',
      } as any)

      const server = manager.getServer('bad-http')
      expect(server).toBeDefined()
      expect(server!.status).toBe('error')
      expect(server!.error).toContain('url is required')
    })

    it('should apply disabledTools filter', async () => {
      await manager.addServer('test', {
        transport: 'stdio',
        command: 'node',
        disabledTools: ['write_file'],
      })

      const server = manager.getServer('test')
      expect(server!.tools.find((t) => t.name === 'write_file')!.enabled).toBe(false)
      expect(server!.tools.find((t) => t.name === 'get_weather')!.enabled).toBe(true)
    })

    it('should strip outputSchema from tool list responses to prevent AJV validation failure on broken $ref', async () => {
      await manager.addServer('test-server', {
        transport: 'stdio',
        command: 'node',
      })

      // The interceptor is now installed on mockTransportInstance via Object.defineProperty.
      // Simulate the SDK setting onmessage — this triggers the setter, which wraps our handler.
      const sdkHandler = vi.fn()
      mockTransportInstance.onmessage = sdkHandler

      // Retrieve the wrapped function (the getter returns the closure-wrapped version)
      const wrappedHandler = mockTransportInstance.onmessage as (msg: unknown) => void

      // Simulate a tools/list response with outputSchema containing broken $ref
      const toolsListMessage = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [
            {
              name: 'stitch_tool',
              description: 'A tool with broken outputSchema',
              inputSchema: { type: 'object' },
              outputSchema: { type: 'object', $ref: '#/$defs/ScreenInstance' },
            },
            {
              name: 'clean_tool',
              description: 'A tool without outputSchema',
              inputSchema: { type: 'object' },
            },
          ],
        },
      }

      wrappedHandler(toolsListMessage)

      // SDK handler should have been called
      expect(sdkHandler).toHaveBeenCalledWith(toolsListMessage)

      // outputSchema should be stripped from the tool that had it
      expect((toolsListMessage.result.tools[0] as any).outputSchema).toBeUndefined()
      // Tool without outputSchema is unaffected
      expect((toolsListMessage.result.tools[1] as any).outputSchema).toBeUndefined()

      // Non-tool-list messages pass through unchanged
      const nonToolMessage = { jsonrpc: '2.0', id: 2, result: { serverInfo: { name: 'test' } } }
      wrappedHandler(nonToolMessage)
      expect(sdkHandler).toHaveBeenCalledWith(nonToolMessage)
    })
  })

  describe('removeServer', () => {
    it('should remove a server and its tools', async () => {
      await manager.addServer('test', { transport: 'stdio', command: 'node' })
      expect(manager.getServer('test')).toBeDefined()

      manager.removeServer('test')
      expect(manager.getServer('test')).toBeUndefined()
    })
  })

  describe('getToolDefinitions', () => {
    it('should return prefixed tool definitions for enabled tools only', async () => {
      await manager.addServer('srv', {
        transport: 'stdio',
        command: 'node',
        disabledTools: ['write_file'],
      })

      const defs = manager.getToolDefinitions()
      expect(defs).toHaveLength(1)
      expect(defs[0]!.function.name).toBe('srv_get_weather')
    })
  })

  describe('callTool', () => {
    it('should call a tool and return the result', async () => {
      await manager.addServer('test', { transport: 'stdio', command: 'node' })

      const result = await manager.callTool('test', 'get_weather', { location: 'Paris' })
      expect(result.success).toBe(true)
      expect(result.output).toBe('Sunny, 72°F')
    })

    it('should return error for unknown server', async () => {
      const result = await manager.callTool('unknown', 'tool', {})
      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('setToolEnabled', () => {
    it('should toggle tool enabled state', async () => {
      await manager.addServer('test', { transport: 'stdio', command: 'node' })

      await manager.setToolEnabled('test', 'get_weather', false)
      const server = manager.getServer('test')
      expect(server!.tools.find((t) => t.name === 'get_weather')!.enabled).toBe(false)

      await manager.setToolEnabled('test', 'get_weather', true)
      expect(server!.tools.find((t) => t.name === 'get_weather')!.enabled).toBe(true)
    })
  })

  describe('cachedTools', () => {
    it('should fall back to cachedTools on connection failure', async () => {
      // Make listTools throw to simulate connection failure
      mockClientInstance.listTools.mockRejectedValueOnce(new Error('Connection refused'))

      await manager.addServer('cached-server', {
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
        cachedTools: [
          { name: 'cached_tool', description: 'From cache', inputSchema: { type: 'object' }, estimatedTokens: 50 },
        ],
      })

      const server = manager.getServer('cached-server')
      expect(server).toBeDefined()
      expect(server!.status).toBe('error')
      expect(server!.error).toContain('Connection refused')
      expect(server!.tools).toHaveLength(1)
      expect(server!.tools[0]!.name).toBe('cached_tool')
      expect(server!.tools[0]!.description).toBe('From cache')
      expect(server!.tools[0]!.enabled).toBe(true)
    })

    it('should apply disabledTools filter to cached tools', async () => {
      mockClientInstance.listTools.mockRejectedValueOnce(new Error('Timeout'))

      await manager.addServer('cached-filtered', {
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
        disabledTools: ['tool_b'],
        cachedTools: [
          { name: 'tool_a', description: 'A', inputSchema: { type: 'object' }, estimatedTokens: 30 },
          { name: 'tool_b', description: 'B', inputSchema: { type: 'object' }, estimatedTokens: 40 },
          { name: 'tool_c', description: 'C', inputSchema: { type: 'object' }, estimatedTokens: 50 },
        ],
      })

      const server = manager.getServer('cached-filtered')
      expect(server!.tools).toHaveLength(3)
      expect(server!.tools.find((t) => t.name === 'tool_a')!.enabled).toBe(true)
      expect(server!.tools.find((t) => t.name === 'tool_b')!.enabled).toBe(false)
      expect(server!.tools.find((t) => t.name === 'tool_c')!.enabled).toBe(true)
    })

    it('should have empty tools when no cachedTools and connection fails', async () => {
      mockClientInstance.listTools.mockRejectedValueOnce(new Error('DNS failure'))

      await manager.addServer('no-cache', {
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
      })

      const server = manager.getServer('no-cache')
      expect(server!.status).toBe('error')
      expect(server!.tools).toHaveLength(0)
    })

    it('should update cachedTools on successful connection and fire callback', async () => {
      const onToolsDiscovered = vi.fn()
      manager = new McpManager({ onToolsDiscovered })

      await manager.addServer('live-server', {
        transport: 'stdio',
        command: 'node',
      })

      const server = manager.getServer('live-server')
      expect(server!.status).toBe('connected')
      expect(server!.tools).toHaveLength(2)

      // Callback should have been called with raw tool definitions
      expect(onToolsDiscovered).toHaveBeenCalledWith('live-server', [
        expect.objectContaining({ name: 'get_weather', estimatedTokens: expect.any(Number) }),
        expect.objectContaining({ name: 'write_file', estimatedTokens: expect.any(Number) }),
      ])
    })

    it('should preserve enabled state from cachedTools when reconnecting successfully', async () => {
      // First: fail and use cache
      mockClientInstance.listTools.mockRejectedValueOnce(new Error('Offline'))
      await manager.addServer('hybrid', {
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
        disabledTools: ['write_file'],
        cachedTools: [
          { name: 'get_weather', description: 'Weather', inputSchema: { type: 'object' }, estimatedTokens: 40 },
          { name: 'write_file', description: 'Write', inputSchema: { type: 'object' }, estimatedTokens: 30 },
        ],
      })

      let server = manager.getServer('hybrid')
      expect(server!.status).toBe('error')
      expect(server!.tools.find((t) => t.name === 'write_file')!.enabled).toBe(false)

      // Second: reconnect successfully (clear the mock rejection)
      mockClientInstance.listTools.mockResolvedValue({
        tools: [
          { name: 'get_weather', description: 'Weather live', inputSchema: { type: 'object' } },
          { name: 'write_file', description: 'Write live', inputSchema: { type: 'object' } },
        ],
      })
      await manager.reconnectServer('hybrid')

      server = manager.getServer('hybrid')
      expect(server!.status).toBe('connected')
      // disabledTools still applies
      expect(server!.tools.find((t) => t.name === 'write_file')!.enabled).toBe(false)
      expect(server!.tools.find((t) => t.name === 'get_weather')!.enabled).toBe(true)
    })
  })

  describe('getToolFingerprint', () => {
    it('should return a sorted comma-separated list of enabled tools', async () => {
      await manager.addServer('b', { transport: 'stdio', command: 'node' })
      await manager.addServer('a', { transport: 'stdio', command: 'node', disabledTools: ['write_file'] })

      const fp = manager.getToolFingerprint()
      expect(fp).toBe('a:get_weather,b:get_weather,b:write_file')
    })
  })
})

describe('createMcpTools', () => {
  it('should create Tool objects from MCP manager', async () => {
    const manager = new McpManager()
    await manager.addServer('test', { transport: 'stdio', command: 'node' })

    const tools = createMcpTools(manager)
    expect(tools).toHaveLength(2)
    expect(tools[0]!.name).toBe('test_get_weather')
    expect(tools[1]!.name).toBe('test_write_file')
    expect(tools[0]!.definition.function.name).toBe('test_get_weather')
  })

  it('should skip disabled tools', async () => {
    const manager = new McpManager()
    await manager.addServer('test', { transport: 'stdio', command: 'node', disabledTools: ['write_file'] })

    const tools = createMcpTools(manager)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('test_get_weather')
  })

  it('should execute tool calls through the manager', async () => {
    const manager = new McpManager()
    await manager.addServer('test', { transport: 'stdio', command: 'node' })

    const tools = createMcpTools(manager)
    const result = await tools[0]!.execute({ location: 'Paris' }, {} as any)
    expect(result.success).toBe(true)
    expect(result.output).toBe('Sunny, 72°F')
  })
})

describe('estimateToolTokens', () => {
  it('should return a positive token estimate for a tool definition', async () => {
    const { estimateToolTokens } = await import('./manager.js')
    const tokens = estimateToolTokens('test_tool', 'A test tool', {
      type: 'object',
      properties: { name: { type: 'string' } },
    })
    expect(tokens).toBeGreaterThan(0)
    expect(Number.isInteger(tokens)).toBe(true)
  })

  it('should return larger estimates for tools with complex schemas', async () => {
    const { estimateToolTokens } = await import('./manager.js')
    const simple = estimateToolTokens('simple', 'Simple', { type: 'object' })
    const complex = estimateToolTokens('complex', 'Complex', {
      type: 'object',
      properties: {
        a: { type: 'string', description: 'A field' },
        b: { type: 'number', description: 'B field' },
        c: { type: 'boolean' },
      },
      required: ['a', 'b'],
    })
    expect(complex).toBeGreaterThan(simple)
  })
})

describe('McpManager token estimation', () => {
  it('should populate estimatedTokens on tools after connection', async () => {
    const manager = new McpManager()
    await manager.addServer('test', { transport: 'stdio', command: 'node' })

    const server = manager.getServer('test')
    expect(server).toBeDefined()
    expect(server!.estimatedTokens).toBeGreaterThan(0)
    for (const tool of server!.tools) {
      expect(tool.estimatedTokens).toBeGreaterThan(0)
    }
  })

  it('should update estimatedTokens when tools are disabled', async () => {
    const manager = new McpManager()
    await manager.addServer('test', { transport: 'stdio', command: 'node' })

    const before = manager.getServer('test')!.estimatedTokens
    await manager.setToolEnabled('test', 'get_weather', false)
    const after = manager.getServer('test')!.estimatedTokens

    expect(after).toBeLessThan(before)
  })
})
