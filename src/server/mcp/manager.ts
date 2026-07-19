import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerConfig, McpServerState, McpToolInfo, McpManagerOptions, CachedToolInfo } from './types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import { logger } from '../utils/logger.js'

/** Rough token estimate: ~4 chars per token for JSON-serialized tool definitions */
export function estimateToolTokens(
  toolName: string,
  description: string | undefined,
  inputSchema: Record<string, unknown>,
): number {
  const def: LLMToolDefinition = {
    type: 'function',
    function: { name: toolName, description: description ?? '', parameters: inputSchema },
  }
  return Math.ceil(JSON.stringify(def).length / 4)
}

interface ServerEntry {
  config: McpServerConfig
  client: Client | undefined
  transport: Transport | null
  state: McpServerState
}

export class McpManager {
  private servers = new Map<string, ServerEntry>()
  private onServersChanged: (() => void) | undefined
  private onToolsDiscovered: ((serverName: string, tools: CachedToolInfo[]) => void) | undefined

  constructor(options?: McpManagerOptions) {
    this.onServersChanged = options?.onServersChanged
    this.onToolsDiscovered = options?.onToolsDiscovered
  }

  async addServer(name: string, config: McpServerConfig): Promise<void> {
    if (this.servers.has(name)) {
      throw new Error(`MCP server '${name}' already exists`)
    }
    const state: McpServerState = { name, config, status: 'disconnected', tools: [], estimatedTokens: 0 }
    this.servers.set(name, { config, client: undefined, transport: null, state })
    await this.connectServer(name)
  }

  removeServer(name: string): void {
    const entry = this.servers.get(name)
    if (entry) {
      this.disconnectServer(name)
      this.servers.delete(name)
    }
  }

  async connectServer(name: string): Promise<void> {
    const entry = this.servers.get(name)
    if (!entry) return

    try {
      await this.disconnectServer(name)

      const client = new Client({ name: 'openfox-mcp', version: '2.0.0' })
      let transport: Transport | null = null

      if (entry.config.transport === 'stdio') {
        if (!entry.config.command) throw new Error('command is required for stdio transport')
        transport = new StdioClientTransport({
          command: entry.config.command,
          ...(entry.config.args ? { args: entry.config.args } : {}),
          ...(entry.config.env ? { env: entry.config.env } : {}),
          stderr: 'pipe',
        })
      } else if (entry.config.transport === 'http') {
        if (!entry.config.url) throw new Error('url is required for http transport')
        const httpOpts: StreamableHTTPClientTransportOptions = {}
        if (entry.config.headers) {
          httpOpts.requestInit = { headers: entry.config.headers }
        }
        transport = new StreamableHTTPClientTransport(new URL(entry.config.url), httpOpts) as unknown as Transport
      } else {
        throw new Error(`Unsupported transport: ${entry.config.transport}`)
      }

      if (!transport) throw new Error('Failed to create transport')

      // Intercept onmessage to remove outputSchema from tool definitions.
      // Some servers (like Stitch) include outputSchema with broken references (e.g. $defs/ScreenInstance),
      // which causes AJV validation in the MCP SDK to crash and fail to load any tools.
      let sdkOnMessage: ((message: any) => void) | undefined = undefined
      Object.defineProperty(transport, 'onmessage', {
        get() {
          return sdkOnMessage
        },
        set(fn) {
          sdkOnMessage = (message: any) => {
            if (message && message.result && Array.isArray(message.result.tools)) {
              for (const tool of message.result.tools) {
                if (tool.outputSchema) {
                  delete tool.outputSchema
                }
              }
            }
            fn?.(message)
          }
        },
        configurable: true,
      })

      await client.connect(transport)

      const { tools: mcpTools } = await client.listTools()

      const disabledSet = new Set(entry.config.disabledTools ?? [])
      const tools: McpToolInfo[] = mcpTools.map((t) => {
        const inputSchema = t.inputSchema as Record<string, unknown>
        return {
          name: t.name,
          description: t.description ?? '',
          inputSchema,
          enabled: !disabledSet.has(t.name),
          estimatedTokens: estimateToolTokens(t.name, t.description, inputSchema),
        }
      })
      const totalTokens = tools.filter((t) => t.enabled).reduce((sum, t) => sum + t.estimatedTokens, 0)

      entry.client = client
      entry.transport = transport
      entry.state = { name, config: entry.config, status: 'connected', tools, estimatedTokens: totalTokens }

      // Update cache with raw tool definitions (without enabled state)
      const cachedTools: CachedToolInfo[] = tools.map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        inputSchema: t.inputSchema,
        estimatedTokens: t.estimatedTokens,
      }))
      entry.config.cachedTools = cachedTools
      this.onToolsDiscovered?.(name, cachedTools)

      logger.info('Connected to MCP server', { name, toolCount: tools.length })
      this.onServersChanged?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error('Failed to connect MCP server', { name, error: msg })

      // Fall back to cached tools if available
      const cachedTools = entry.config.cachedTools
      if (cachedTools && cachedTools.length > 0) {
        const disabledSet = new Set(entry.config.disabledTools ?? [])
        const tools: McpToolInfo[] = cachedTools.map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema,
          enabled: !disabledSet.has(t.name),
          estimatedTokens: t.estimatedTokens,
        }))
        const totalTokens = tools.filter((t) => t.enabled).reduce((sum, t) => sum + t.estimatedTokens, 0)
        entry.state = { name, config: entry.config, status: 'error', tools, estimatedTokens: totalTokens, error: msg }
      } else {
        entry.state = { name, config: entry.config, status: 'error', tools: [], estimatedTokens: 0, error: msg }
      }
      this.onServersChanged?.()
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const entry = this.servers.get(name)
    if (!entry) return
    try {
      await entry.client?.close()
    } catch {
      /* ignore close errors */
    }
    entry.client = undefined
    entry.transport = null
    entry.state = { name, config: entry.config, status: 'disconnected', tools: [], estimatedTokens: 0 }
  }

  async disconnectAll(): Promise<void> {
    for (const name of this.servers.keys()) {
      await this.disconnectServer(name)
    }
  }

  async reconnectServer(name: string): Promise<void> {
    await this.connectServer(name)
  }

  getServer(name: string): McpServerState | undefined {
    return this.servers.get(name)?.state
  }

  getAllServers(): McpServerState[] {
    return Array.from(this.servers.values()).map((e) => e.state)
  }

  getToolDefinitions(): LLMToolDefinition[] {
    const defs: LLMToolDefinition[] = []
    for (const [, entry] of this.servers) {
      for (const tool of entry.state.tools) {
        if (!tool.enabled) continue
        defs.push({
          type: 'function',
          function: {
            name: `${entry.state.name}_${tool.name}`,
            description: tool.description ?? '',
            parameters: tool.inputSchema as Record<string, unknown>,
          },
        })
      }
    }
    return defs
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    const entry = this.servers.get(serverName)
    if (!entry) return { success: false, error: `MCP server '${serverName}' not found` }

    if (!entry.client) return { success: false, error: `MCP server '${serverName}' is not connected` }
    try {
      const result = await entry.client.callTool({ name: toolName, arguments: args })
      const content = result.content as Array<{ type: string; text?: string }>
      const textParts = content.filter((c) => c.type === 'text').map((c) => c.text)
      return { success: !result.isError, output: textParts.join('\n') }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async setToolEnabled(serverName: string, toolName: string, enabled: boolean): Promise<void> {
    const entry = this.servers.get(serverName)
    if (!entry) throw new Error(`MCP server '${serverName}' not found`)
    const tool = entry.state.tools.find((t) => t.name === toolName)
    if (!tool) throw new Error(`Tool '${toolName}' not found on server '${serverName}'`)
    tool.enabled = enabled
    entry.state.estimatedTokens = entry.state.tools
      .filter((t) => t.enabled)
      .reduce((sum, t) => sum + t.estimatedTokens, 0)
    this.onServersChanged?.()
  }

  getToolFingerprint(): string {
    const parts: string[] = []
    for (const [, entry] of this.servers) {
      for (const tool of entry.state.tools) {
        if (tool.enabled) {
          parts.push(`${entry.state.name}:${tool.name}`)
        }
      }
    }
    return parts.sort().join(',')
  }
}
