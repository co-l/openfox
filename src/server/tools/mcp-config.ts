import type { Tool } from './types.js'
import type { McpManager } from '../mcp/manager.js'
import { createTool, validateActionWithPermission } from './tool-helpers.js'
import type { McpServerConfig } from '../mcp/types.js'
import type { Mode } from '../../cli/main.js'
import { loadGlobalConfig, saveGlobalConfig } from '../../cli/config.js'
import { createMcpTools } from '../mcp/tool-adapter.js'
import { applyMcpServerUpdate } from '../mcp/update-server.js'
import { serverT } from '../i18n.js'

interface McpConfigArgs {
  action: 'list' | 'add' | 'update' | 'remove' | 'toggle-tool' | 'bootstrap'
  name?: string
  transport?: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  toolName?: string
  enabled?: boolean
  timeout?: number
}

export type McpBootstrapProvider = () => Promise<unknown>

let mcpManagerForTools: McpManager | null = null
let mcpConfigMode: Mode = 'production'
let mcpConfigPath: string | undefined
let mcpNotifyChanged: ((sessionId: string) => void) | null = null
let mcpBootstrapForTools: McpBootstrapProvider | null = null

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

export function setMcpBootstrapForTools(fn: McpBootstrapProvider): void {
  mcpBootstrapForTools = fn
}

export function resetMcpBootstrapForTools(): void {
  mcpBootstrapForTools = null
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
        'Configure MCP servers (Model Context Protocol). Actions: list (show all servers and tools), add (add a server), update (modify an existing server — all fields are optional and merged with the current config, transport-incompatible fields are cleared on transport change), remove (delete a server), toggle-tool (enable/disable a tool), bootstrap (get a ready-to-paste client config for this OpenFox server itself, so the session can connect to it as an MCP client). Use this when the user asks to add, remove, update, or configure MCP servers or tools.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'add', 'update', 'remove', 'toggle-tool', 'bootstrap'],
            description:
              'Action: list (show servers), add (add new server), update (modify existing server), remove (delete a server), toggle-tool (enable/disable a tool), bootstrap (client config for this server)',
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
          timeout: {
            type: 'number',
            description: 'Timeout in seconds for MCP tool calls (optional)',
          },
        },
        required: ['action'],
      },
    },
  },
  async (args, context, helpers) => {
    const actionError = validateActionWithPermission(
      args.action,
      ['list', 'add', 'update', 'remove', 'toggle-tool', 'bootstrap'],
      'mcp_config',
      context.permittedActions,
    )
    if (actionError) return actionError

    if (args.action === 'bootstrap') {
      if (!mcpBootstrapForTools) {
        return helpers.error(
          serverT({
            en: 'MCP bootstrap is not available for this server',
            fr: 'Le bootstrap MCP n’est pas disponible pour ce serveur',
          }),
        )
      }
      const config = await mcpBootstrapForTools()
      return helpers.success(JSON.stringify(config, null, 2))
    }

    if (!mcpManagerForTools) {
      return helpers.error(serverT({ en: 'MCP manager not available', fr: 'Gestionnaire MCP indisponible' }))
    }

    async function persistAndRebuild(
      updater: (config: Record<string, McpServerConfig>) => Record<string, McpServerConfig>,
    ): Promise<void> {
      const globalConfig = await loadGlobalConfig(mcpConfigMode, mcpConfigPath)
      const mcpServers = { ...((globalConfig.mcpServers ?? {}) as Record<string, McpServerConfig>) }
      const updated = updater(mcpServers)
      await saveGlobalConfig(mcpConfigMode, { ...globalConfig, mcpServers: updated }, mcpConfigPath)
    }

    const APPLY_PROMPT_MESSAGE = serverT({
      en: 'Tool changes are announced automatically.',
      fr: 'Les modifications d’outils sont annoncées automatiquement.',
    })

    async function notifyContextChanged(sessionId: string): Promise<void> {
      context.sessionManager.setDynamicContextChanged(sessionId, true)
      mcpNotifyChanged?.(sessionId)
      // Instant announcement at the point of contention — the agent sees what
      // changed in its tools immediately, not at the next turn start.
      const { injectContextDriftReminders } = await import('../chat/dynamic-context.js')
      await injectContextDriftReminders(context.sessionManager, sessionId)
    }

    async function rebuildTools(): Promise<void> {
      const { setMcpTools } = await import('./index.js')
      const mcpTools = createMcpTools(mcpManagerForTools!)
      setMcpTools(mcpTools)
    }

    if (args.action === 'list') {
      const servers = mcpManagerForTools.getAllServers()
      if (servers.length === 0) {
        return helpers.success(serverT({ en: 'No MCP servers configured.', fr: 'Aucun serveur MCP configuré.' }))
      }

      const { getSessionDisabledServers } = await import('../mcp/session-overrides.js')
      const disabledForSession = new Set(context.sessionId ? getSessionDisabledServers(context.sessionId) : [])

      const visibleServers = servers.filter((server) => !disabledForSession.has(server.name))
      if (visibleServers.length === 0) {
        return helpers.success(serverT({ en: 'No MCP servers configured.', fr: 'Aucun serveur MCP configuré.' }))
      }

      const lines: string[] = []
      for (const server of visibleServers) {
        const connStr = server.status === 'connected' ? '●' : server.status === 'error' ? '✗' : '○'
        const cmdStr = server.config.command
          ? `${server.config.command} ${(server.config.args ?? []).join(' ')}`
          : (server.config.url ?? '')
        const hasCachedTools = server.tools.length > 0
        const sourceLabel =
          server.status === 'connected'
            ? serverT({ en: ' (live)', fr: ' (en direct)' })
            : hasCachedTools
              ? serverT({ en: ' (from cache)', fr: ' (depuis le cache)' })
              : ''
        const statusLine = server.error
          ? `${server.status}${sourceLabel}: ${server.error}`
          : `${server.status}${sourceLabel}`
        lines.push(`${connStr} ${server.name} (${server.config.transport}) — ${statusLine}`)
        lines.push(`  ${cmdStr}`)
        lines.push(
          serverT(
            { en: '  {{count}} tools, ~{{tokens}} tokens', fr: '  {{count}} outils, ~{{tokens}} tokens' },
            { count: server.tools.length, tokens: server.estimatedTokens },
          ),
        )

        const enabledTools = server.tools.filter((t) => t.enabled)
        const disabledTools = server.tools.filter((t) => !t.enabled)
        if (enabledTools.length > 0) {
          lines.push(
            serverT(
              { en: '  Enabled: {{list}}', fr: '  Activés : {{list}}' },
              { list: enabledTools.map((t) => t.name).join(', ') },
            ),
          )
        }
        if (disabledTools.length > 0) {
          lines.push(
            serverT(
              { en: '  Disabled: {{list}}', fr: '  Désactivés : {{list}}' },
              { list: disabledTools.map((t) => t.name).join(', ') },
            ),
          )
        }
      }
      return helpers.success(lines.join('\n'))
    }

    if (args.action === 'add') {
      if (!args.name)
        return helpers.error(serverT({ en: 'Missing required field: name', fr: 'Champ requis manquant : name' }))
      if (args.transport === 'http') {
        if (!args.url)
          return helpers.error(
            serverT({ en: 'url is required for http transport', fr: 'url est requis pour le transport http' }),
          )
      } else if (!args.command) {
        return helpers.error(
          serverT({ en: 'command is required for stdio transport', fr: 'command est requis pour le transport stdio' }),
        )
      }
      if (args.timeout !== undefined && (typeof args.timeout !== 'number' || args.timeout <= 0)) {
        return helpers.error(
          serverT({ en: 'timeout must be a positive number', fr: 'timeout doit être un nombre positif' }),
        )
      }

      const serverCfg: McpServerConfig = {
        transport: args.transport ?? 'stdio',
        ...(args.command ? { command: args.command } : {}),
        ...(args.args && args.args.length > 0 ? { args: args.args } : {}),
        ...(args.env && Object.keys(args.env).length > 0 ? { env: args.env } : {}),
        ...(args.url ? { url: args.url } : {}),
        ...(args.headers && Object.keys(args.headers).length > 0 ? { headers: args.headers } : {}),
        ...(args.timeout !== undefined ? { timeout: args.timeout } : {}),
      }

      await persistAndRebuild((mcpServers) => {
        mcpServers[args.name!] = serverCfg
        return mcpServers
      })
      await mcpManagerForTools.addServer(args.name, serverCfg)
      await rebuildTools()
      await notifyContextChanged(context.sessionId)

      const server = mcpManagerForTools.getServer(args.name)
      const toolCount = server?.tools.length ?? 0
      return helpers.success(
        serverT(
          {
            en: 'Added MCP server "{{name}}" ({{count}} tools discovered). {{prompt}}',
            fr: 'Serveur MCP « {{name}} » ajouté ({{count}} outils découverts). {{prompt}}',
          },
          { name: args.name ?? '', count: toolCount, prompt: APPLY_PROMPT_MESSAGE },
        ),
      )
    }

    if (args.action === 'update') {
      if (!args.name)
        return helpers.error(serverT({ en: 'Missing required field: name', fr: 'Champ requis manquant : name' }))
      const existing = mcpManagerForTools.getServer(args.name)
      if (!existing)
        return helpers.error(
          serverT(
            { en: 'MCP server "{{name}}" not found', fr: 'Serveur MCP « {{name}} » introuvable' },
            { name: args.name ?? '' },
          ),
        )

      const globalConfig = await loadGlobalConfig(mcpConfigMode, mcpConfigPath)
      const mcpServers = { ...((globalConfig.mcpServers ?? {}) as Record<string, McpServerConfig>) }

      const patch = {
        ...(args.transport !== undefined ? { transport: args.transport } : {}),
        ...(args.command !== undefined ? { command: args.command } : {}),
        ...(args.args !== undefined ? { args: args.args } : {}),
        ...(args.env !== undefined ? { env: args.env } : {}),
        ...(args.url !== undefined ? { url: args.url } : {}),
        ...(args.headers !== undefined ? { headers: args.headers } : {}),
        ...(args.timeout !== undefined ? { timeout: args.timeout } : {}),
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
      await notifyContextChanged(context.sessionId)

      const server = mcpManagerForTools.getServer(args.name)
      const toolCount = server?.tools.length ?? 0
      return helpers.success(
        serverT(
          {
            en: 'Updated MCP server "{{name}}" ({{count}} tools discovered). {{prompt}}',
            fr: 'Serveur MCP « {{name}} » mis à jour ({{count}} outils découverts). {{prompt}}',
          },
          { name: args.name ?? '', count: toolCount, prompt: APPLY_PROMPT_MESSAGE },
        ),
      )
    }

    if (args.action === 'remove') {
      if (!args.name)
        return helpers.error(serverT({ en: 'Missing required field: name', fr: 'Champ requis manquant : name' }))
      await persistAndRebuild((mcpServers) => {
        delete mcpServers[args.name!]
        return mcpServers
      })
      mcpManagerForTools.removeServer(args.name)
      await rebuildTools()
      await notifyContextChanged(context.sessionId)
      return helpers.success(
        serverT(
          { en: 'Removed MCP server "{{name}}". {{prompt}}', fr: 'Serveur MCP « {{name}} » supprimé. {{prompt}}' },
          { name: args.name ?? '', prompt: APPLY_PROMPT_MESSAGE },
        ),
      )
    }

    if (args.action === 'toggle-tool') {
      if (!args.name)
        return helpers.error(serverT({ en: 'Missing required field: name', fr: 'Champ requis manquant : name' }))
      if (!args.toolName)
        return helpers.error(
          serverT({ en: 'Missing required field: toolName', fr: 'Champ requis manquant : toolName' }),
        )
      if (args.enabled === undefined)
        return helpers.error(serverT({ en: 'Missing required field: enabled', fr: 'Champ requis manquant : enabled' }))

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
      await notifyContextChanged(context.sessionId)

      return helpers.success(
        serverT(
          {
            en: 'Tool "{{tool}}" {{state}} on server "{{name}}". {{prompt}}',
            fr: 'Outil « {{tool}} » {{state}} sur le serveur « {{name}} ». {{prompt}}',
          },
          {
            tool: args.toolName ?? '',
            state: args.enabled
              ? serverT({ en: 'enabled', fr: 'activé' })
              : serverT({ en: 'disabled', fr: 'désactivé' }),
            name: args.name ?? '',
            prompt: APPLY_PROMPT_MESSAGE,
          },
        ),
      )
    }

    return helpers.error(serverT({ en: 'Unexpected error', fr: 'Erreur inattendue' }))
  },
)
