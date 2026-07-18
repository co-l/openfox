import type { Tool } from './types.js'
import type { McpManager } from '../mcp/manager.js'
import { createTool, validateActionWithPermission } from './tool-helpers.js'
import type { McpServerConfig } from '../mcp/types.js'
import type { Mode } from '../../cli/main.js'
import { loadGlobalConfig, saveGlobalConfig } from '../../cli/config.js'
import { createMcpTools } from '../mcp/tool-adapter.js'
import { applyMcpServerUpdate } from '../mcp/update-server.js'

interface McpConfigArgs {
  action: 'list' | 'add' | 'update' | 'remove' | 'toggle-tool'
  name?: string
  transport?: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  toolName?: string
  enabled?: boolean
}

let mcpManagerForTools: McpManager | null = null
let mcpConfigMode: Mode = 'production'
let mcpConfigPath: string | undefined
let mcpNotifyChanged: ((sessionId: string) => void) | null = null

export function setMcpManagerForTools(manager: McpManager): void {
  mcpManagerForTools = manager
}

export function setMcpConfigMode(mode: Mode): void {
  mcpConfigMode = mode
}

export function setMcpConfigPath(path: string | undefined): void {
  mcpConfigPath = path
}

export function setNotifyMcpServersChanged(fn: (sessionId: string) => void): void {
  mcpNotifyChanged = fn
}

export function resetMcpManagerForTools(): void {
  mcpManagerForTools = null
  mcpNotifyChanged = null
}

export const mcpConfigTool: Tool = createTool<McpConfigArgs>(
  'mcp_config',
  {
    type: 'function',
    function: {
      name: 'mcp_config',
      description:
        'Configure MCP servers (Model Context Protocol). Actions: list (show all servers and tools), add (add a server), update (modify an existing server — all fields are optional and merged with the current config, transport-incompatible fields are cleared on transport change), remove (delete a server), toggle-tool (enable/disable a tool). Use this when the user asks to add, remove, update, or configure MCP servers or tools.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'add', 'update', 'remove', 'toggle-tool'],
            description:
              'Action: list (show servers), add (add new server), update (modify existing server), remove (delete a server), toggle-tool (enable/disable a tool)',
          },
          name: {
            type: 'string',
            description: 'Server name (required for: add, update, remove, toggle-tool)',
          },
          transport: {
            type: 'string',
            enum: ['stdio', 'http'],
            description: 'Transport type (for add). Default: stdio',
          },
          command: {
            type: 'string',
            description: 'Command for stdio transport (e.g. "npx")',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Command arguments for stdio transport',
          },
          env: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Environment variables for stdio transport',
          },
          url: {
            type: 'string',
            description: 'Server URL for HTTP transport (e.g. "https://mcp.example.com/mcp")',
          },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'HTTP headers for HTTP transport (e.g. {"Authorization": "Bearer xxx"})',
          },
          toolName: {
            type: 'string',
            description: 'Tool name to toggle (required for: toggle-tool)',
          },
          enabled: {
            type: 'boolean',
            description: 'Whether the tool should be enabled (required for: toggle-tool)',
          },
        },
        required: ['action'],
      },
    },
  },
  async (args, context, helpers) => {
    const actionError = validateActionWithPermission(
      args.action,
      ['list', 'add', 'update', 'remove', 'toggle-tool'],
      'mcp_config',
      context.permittedActions,
    )
    if (actionError) return actionError

    if (!mcpManagerForTools) {
      return helpers.error('MCP manager not available')
    }

    async function persistAndRebuild(
      updater: (config: Record<string, McpServerConfig>) => Record<string, McpServerConfig>,
    ): Promise<void> {
      const globalConfig = await loadGlobalConfig(mcpConfigMode, mcpConfigPath)
      const mcpServers = { ...((globalConfig.mcpServers ?? {}) as Record<string, McpServerConfig>) }
      const updated = updater(mcpServers)
      await saveGlobalConfig(mcpConfigMode, { ...globalConfig, mcpServers: updated }, mcpConfigPath)
    }

    const APPLY_PROMPT_MESSAGE = 'The user must click "Update system prompt" to apply changes.'

    function notifyContextChanged(sessionId: string): void {
      context.sessionManager.setDynamicContextChanged(sessionId, true)
      mcpNotifyChanged?.(sessionId)
    }

    async function rebuildTools(): Promise<void> {
      const { setMcpTools } = await import('./index.js')
      const mcpTools = createMcpTools(mcpManagerForTools!)
      setMcpTools(mcpTools)
    }

    if (args.action === 'list') {
      const servers = mcpManagerForTools.getAllServers()
      if (servers.length === 0) {
        return helpers.success('No MCP servers configured.')
      }

      const lines: string[] = []
      for (const server of servers) {
        const connStr = server.status === 'connected' ? '●' : server.status === 'error' ? '✗' : '○'
        const cmdStr = server.config.command
          ? `${server.config.command} ${(server.config.args ?? []).join(' ')}`
          : (server.config.url ?? '')
        const hasCachedTools = server.tools.length > 0
        const sourceLabel = server.status === 'connected' ? ' (live)' : hasCachedTools ? ' (from cache)' : ''
        const statusLine = server.error
          ? `${server.status}${sourceLabel}: ${server.error}`
          : `${server.status}${sourceLabel}`
        lines.push(`${connStr} ${server.name} (${server.config.transport}) — ${statusLine}`)
        lines.push(`  ${cmdStr}`)
        lines.push(`  ${server.tools.length} tools, ~${server.estimatedTokens} tokens`)

        const enabledTools = server.tools.filter((t) => t.enabled)
        const disabledTools = server.tools.filter((t) => !t.enabled)
        if (enabledTools.length > 0) {
          lines.push(`  Enabled: ${enabledTools.map((t) => t.name).join(', ')}`)
        }
        if (disabledTools.length > 0) {
          lines.push(`  Disabled: ${disabledTools.map((t) => t.name).join(', ')}`)
        }
      }
      return helpers.success(lines.join('\n'))
    }

    if (args.action === 'add') {
      if (!args.name) return helpers.error('Missing required field: name')
      if (args.transport === 'http') {
        if (!args.url) return helpers.error('url is required for http transport')
      } else if (!args.command) {
        return helpers.error('command is required for stdio transport')
      }

      const serverCfg: McpServerConfig = {
        transport: args.transport ?? 'stdio',
        ...(args.command ? { command: args.command } : {}),
        ...(args.args && args.args.length > 0 ? { args: args.args } : {}),
        ...(args.env && Object.keys(args.env).length > 0 ? { env: args.env } : {}),
        ...(args.url ? { url: args.url } : {}),
        ...(args.headers && Object.keys(args.headers).length > 0 ? { headers: args.headers } : {}),
      }

      await persistAndRebuild((mcpServers) => {
        mcpServers[args.name!] = serverCfg
        return mcpServers
      })
      await mcpManagerForTools.addServer(args.name, serverCfg)
      await rebuildTools()
      notifyContextChanged(context.sessionId)

      const server = mcpManagerForTools.getServer(args.name)
      const toolCount = server?.tools.length ?? 0
      return helpers.success(`Added MCP server "${args.name}" (${toolCount} tools discovered). ${APPLY_PROMPT_MESSAGE}`)
    }

    if (args.action === 'update') {
      if (!args.name) return helpers.error('Missing required field: name')
      const existing = mcpManagerForTools.getServer(args.name)
      if (!existing) return helpers.error(`MCP server "${args.name}" not found`)

      const globalConfig = await loadGlobalConfig(mcpConfigMode, mcpConfigPath)
      const mcpServers = { ...((globalConfig.mcpServers ?? {}) as Record<string, McpServerConfig>) }

      const patch = {
        ...(args.transport !== undefined ? { transport: args.transport } : {}),
        ...(args.command !== undefined ? { command: args.command } : {}),
        ...(args.args !== undefined ? { args: args.args } : {}),
        ...(args.env !== undefined ? { env: args.env } : {}),
        ...(args.url !== undefined ? { url: args.url } : {}),
        ...(args.headers !== undefined ? { headers: args.headers } : {}),
      }

      const { error: updateError } = await applyMcpServerUpdate({
        name: args.name,
        patch,
        existing,
        persistedCfg: mcpServers[args.name],
        mcpManager: mcpManagerForTools,
        save: async (cfg) => {
          mcpServers[args.name!] = cfg
          await saveGlobalConfig(mcpConfigMode, { ...globalConfig, mcpServers }, mcpConfigPath)
        },
      })

      if (updateError) return helpers.error(updateError)
      await rebuildTools()
      notifyContextChanged(context.sessionId)

      const server = mcpManagerForTools.getServer(args.name)
      const toolCount = server?.tools.length ?? 0
      return helpers.success(`Updated MCP server "${args.name}" (${toolCount} tools discovered). ${APPLY_PROMPT_MESSAGE}`)
    }

    if (args.action === 'remove') {
      if (!args.name) return helpers.error('Missing required field: name')
      await persistAndRebuild((mcpServers) => {
        delete mcpServers[args.name!]
        return mcpServers
      })
      mcpManagerForTools.removeServer(args.name)
      await rebuildTools()
      notifyContextChanged(context.sessionId)
      return helpers.success(`Removed MCP server "${args.name}". ${APPLY_PROMPT_MESSAGE}`)
    }

    if (args.action === 'toggle-tool') {
      if (!args.name) return helpers.error('Missing required field: name')
      if (!args.toolName) return helpers.error('Missing required field: toolName')
      if (args.enabled === undefined) return helpers.error('Missing required field: enabled')

      const server = mcpManagerForTools.getServer(args.name)
      const currentDisabled = (server?.tools ?? []).filter((t) => !t.enabled).map((t) => t.name)
      const afterDisabled = args.enabled
        ? currentDisabled.filter((n) => n !== args.toolName)
        : [...currentDisabled, args.toolName]

      await persistAndRebuild((mcpServers) => {
        const cfg = mcpServers[args.name!]
        if (cfg) {
          const updated = { ...cfg }
          if (afterDisabled.length > 0) {
            updated.disabledTools = afterDisabled
          } else {
            delete updated.disabledTools
          }
          mcpServers[args.name!] = updated
        }
        return mcpServers
      })

      await mcpManagerForTools.setToolEnabled(args.name, args.toolName, args.enabled)
      await rebuildTools()
      notifyContextChanged(context.sessionId)

      return helpers.success(
        `Tool "${args.toolName}" ${args.enabled ? 'enabled' : 'disabled'} on server "${args.name}". ${APPLY_PROMPT_MESSAGE}`,
      )
    }

    return helpers.error('Unexpected error')
  },
)
