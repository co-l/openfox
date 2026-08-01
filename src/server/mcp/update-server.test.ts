import { describe, expect, it, vi, beforeEach } from 'vitest'
import { McpManager } from './manager.js'
import { applyMcpServerUpdate } from './update-server.js'
import type { McpServerConfig } from './types.js'

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function () {
    return {
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
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false }),
    }
  }),
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

const defaultCfg: McpServerConfig = { transport: 'stdio', command: 'node' }

describe('applyMcpServerUpdate server isolation', () => {
  let manager: McpManager
  let savedCfg: McpServerConfig | undefined
  const save = vi.fn(async (cfg: McpServerConfig) => {
    savedCfg = cfg
  })

  beforeEach(async () => {
    savedCfg = undefined
    manager = new McpManager()
    await manager.addServer('alpha', defaultCfg)
    await manager.addServer('beta', defaultCfg)
  })

  it('both servers should be connected after setup', () => {
    const alpha = manager.getServer('alpha')!
    const beta = manager.getServer('beta')!
    // Debug: if beta has an error, its .error field contains the error message
    expect(beta.status).toBe('connected')
    // This assertion will show the error message when it fails
    expect(alpha.status).toBe('connected')
    expect(alpha.tools).toHaveLength(2)
    expect(beta.tools).toHaveLength(2)
  })

  it('should toggle alpha disabled without affecting beta', async () => {
    const existing = manager.getServer('alpha')!

    const { error } = await applyMcpServerUpdate({
      name: 'alpha',
      patch: { disabled: true },
      existing,
      persistedCfg: defaultCfg,
      mcpManager: manager,
      save,
    })

    expect(error).toBeUndefined()

    const alpha = manager.getServer('alpha')!
    const beta = manager.getServer('beta')!
    // alpha is still connected (disabled only affects visibility)
    expect(alpha.status).toBe('connected')
    expect(alpha.config.disabled).toBe(true)
    expect(alpha.tools.length).toBeGreaterThan(0)
    expect(beta.status).toBe('connected')
    expect(beta.tools).toHaveLength(2)
  })

  it('should re-enable alpha without affecting beta', async () => {
    const existing = manager.getServer('alpha')!
    await applyMcpServerUpdate({
      name: 'alpha',
      patch: { disabled: true },
      existing,
      persistedCfg: defaultCfg,
      mcpManager: manager,
      save,
    })

    const existingAfter = manager.getServer('alpha')!
    await applyMcpServerUpdate({
      name: 'alpha',
      patch: { disabled: false },
      existing: existingAfter,
      persistedCfg: savedCfg,
      mcpManager: manager,
      save,
    })

    const alpha = manager.getServer('alpha')!
    const beta = manager.getServer('beta')!
    expect(alpha.status).toBe('connected')
    expect(alpha.tools).toHaveLength(2)
    expect(beta.status).toBe('connected')
    expect(beta.tools).toHaveLength(2)
  })

  it('should not affect beta after patch with no disabled field', async () => {
    const existing = manager.getServer('alpha')!

    const { error } = await applyMcpServerUpdate({
      name: 'alpha',
      patch: {},
      existing,
      persistedCfg: defaultCfg,
      mcpManager: manager,
      save,
    })

    expect(error).toBeUndefined()

    const alpha = manager.getServer('alpha')!
    const beta = manager.getServer('beta')!
    expect(alpha.status).toBe('connected')
    expect(alpha.tools).toHaveLength(2)
    expect(beta.status).toBe('connected')
    expect(beta.tools).toHaveLength(2)
  })
})

describe('applyMcpServerUpdate oauth patch semantics', () => {
  let manager: McpManager
  let savedCfg: McpServerConfig | undefined
  const save = vi.fn(async (cfg: McpServerConfig) => {
    savedCfg = cfg
  })
  const oauthHttpCfg: McpServerConfig = { transport: 'http', url: 'https://mcp.example.com/mcp', oauth: true }

  beforeEach(async () => {
    savedCfg = undefined
    manager = new McpManager()
    await manager.addServer('srv', oauthHttpCfg)
  })

  it('keeps oauth: true when the patch does not mention oauth', async () => {
    const existing = manager.getServer('srv')!

    const { serverCfg, error } = await applyMcpServerUpdate({
      name: 'srv',
      patch: { timeout: 30 },
      existing,
      persistedCfg: oauthHttpCfg,
      mcpManager: manager,
      save,
    })

    expect(error).toBeUndefined()
    expect(serverCfg.oauth).toBe(true)
    expect(savedCfg?.oauth).toBe(true)
  })

  it('drops the oauth key entirely when the patch sets oauth: false (absent = disabled)', async () => {
    const existing = manager.getServer('srv')!

    const { serverCfg, error } = await applyMcpServerUpdate({
      name: 'srv',
      patch: { oauth: false },
      existing,
      persistedCfg: oauthHttpCfg,
      mcpManager: manager,
      save,
    })

    expect(error).toBeUndefined()
    expect(serverCfg).not.toHaveProperty('oauth')
    expect(savedCfg).not.toHaveProperty('oauth')
  })

  it('drops oauth, like url and headers, when switching transport from http to stdio', async () => {
    const existing = manager.getServer('srv')!

    const { serverCfg, error } = await applyMcpServerUpdate({
      name: 'srv',
      patch: { transport: 'stdio', command: 'node' },
      existing,
      persistedCfg: oauthHttpCfg,
      mcpManager: manager,
      save,
    })

    expect(error).toBeUndefined()
    expect(serverCfg).not.toHaveProperty('oauth')
    expect(serverCfg).not.toHaveProperty('url')
    expect(serverCfg).not.toHaveProperty('headers')
    expect(savedCfg).not.toHaveProperty('oauth')
  })
})
