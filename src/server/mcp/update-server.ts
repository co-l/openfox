import type { McpManager } from './manager.js'
import type { McpServerConfig, McpServerState } from './types.js'

export interface McpServerPatch {
  transport?: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface ApplyMcpServerUpdateOptions {
  name: string
  patch: McpServerPatch
  existing: McpServerState
  persistedCfg: McpServerConfig | undefined
  mcpManager: McpManager
  save: (serverCfg: McpServerConfig) => Promise<void>
}

export function buildUpdatedServerConfig(
  patch: McpServerPatch,
  existing: McpServerState,
  persistedCfg: McpServerConfig | undefined,
): { serverCfg: McpServerConfig; error?: string } {
  const existingTransport: 'stdio' | 'http' = existing.config.transport ?? 'stdio'
  const resolvedTransport: 'stdio' | 'http' = patch.transport ?? existingTransport
  const transportChanged = resolvedTransport !== existingTransport

  const mergedCommand =
    patch.command !== undefined ? patch.command : transportChanged ? undefined : existing.config.command
  const mergedArgs = patch.args !== undefined ? patch.args : transportChanged ? undefined : existing.config.args
  const mergedEnv = patch.env !== undefined ? patch.env : transportChanged ? undefined : existing.config.env
  const mergedUrl = patch.url !== undefined ? patch.url : transportChanged ? undefined : existing.config.url
  const mergedHeaders =
    patch.headers !== undefined ? patch.headers : transportChanged ? undefined : existing.config.headers

  if (resolvedTransport === 'http' && !mergedUrl) {
    return { serverCfg: {} as McpServerConfig, error: 'url is required for http transport' }
  }
  if (resolvedTransport !== 'http' && !mergedCommand) {
    return { serverCfg: {} as McpServerConfig, error: 'command is required for stdio transport' }
  }

  const serverCfg: McpServerConfig = {
    transport: resolvedTransport,
    ...(mergedCommand ? { command: mergedCommand } : {}),
    ...(mergedArgs && mergedArgs.length > 0 ? { args: mergedArgs } : {}),
    ...(mergedEnv && Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
    ...(mergedUrl ? { url: mergedUrl } : {}),
    ...(mergedHeaders && Object.keys(mergedHeaders).length > 0 ? { headers: mergedHeaders } : {}),
    ...(persistedCfg?.disabledTools && persistedCfg.disabledTools.length > 0
      ? { disabledTools: persistedCfg.disabledTools }
      : {}),
    ...(persistedCfg?.cachedTools && persistedCfg.cachedTools.length > 0
      ? { cachedTools: persistedCfg.cachedTools }
      : {}),
  }

  return { serverCfg }
}

export async function applyMcpServerUpdate(
  options: ApplyMcpServerUpdateOptions,
): Promise<{ serverCfg: McpServerConfig; error?: string }> {
  const { name, patch, existing, persistedCfg, mcpManager, save } = options

  const { serverCfg, error } = buildUpdatedServerConfig(patch, existing, persistedCfg)
  if (error) return { serverCfg: {} as McpServerConfig, error }

  mcpManager.removeServer(name)
  try {
    await mcpManager.addServer(name, serverCfg)
  } catch (addError) {
    await mcpManager.addServer(name, existing.config)
    throw addError
  }

  try {
    await save(serverCfg)
  } catch (saveError) {
    mcpManager.removeServer(name)
    await mcpManager.addServer(name, existing.config)
    throw saveError
  }

  return { serverCfg }
}
