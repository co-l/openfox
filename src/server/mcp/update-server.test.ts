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
