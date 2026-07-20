import type { LLMToolDefinition } from '../llm/types.js'

export interface CachedToolInfo {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  estimatedTokens: number
}

export interface McpServerConfig {
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  disabledTools?: string[]
  cachedTools?: CachedToolInfo[]
  timeout?: number
}

export interface McpServerState {
  name: string
  config: McpServerConfig
  status: 'connected' | 'disconnected' | 'error'
  tools: McpToolInfo[]
  estimatedTokens: number
  error?: string
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  enabled: boolean
  estimatedTokens: number
}

export interface McpManagerOptions {
  onServersChanged?: () => void
  onToolsDiscovered?: (serverName: string, tools: CachedToolInfo[]) => void
}

export interface McpToolDefinition extends LLMToolDefinition {
  serverName: string
}
