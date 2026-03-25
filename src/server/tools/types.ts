import type { ToolResult, StatsIdentity } from '../../shared/types.js'
export type { ToolResult } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { LspManagerInterface } from '../lsp/types.js'
import type { SessionManager } from '../session/manager.js'
import type { LLMClientWithModel } from '../llm/client.js'

export interface ToolContext {
  workdir: string
  sessionId: string
  sessionManager: SessionManager  // Injected dependency (replaces singleton import)
  signal?: AbortSignal | undefined  // For cancelling long-running operations (e.g., shell commands)
  onProgress?: ((message: string) => void) | undefined
  onEvent?: ((event: ServerMessage) => void) | undefined  // For sending events to client (e.g., path confirmation)
  lspManager?: LspManagerInterface | undefined  // Optional LSP manager for file diagnostics
  llmClient?: LLMClientWithModel | undefined  // For tools that need to spawn LLM calls (e.g., call_sub_agent)
  statsIdentity?: StatsIdentity | undefined  // For tools that track metrics
}

export interface Tool {
  name: string
  definition: LLMToolDefinition
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
}

export interface ToolRegistry {
  tools: Tool[]
  definitions: LLMToolDefinition[]
  execute: (name: string, args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
}

// Output limits to prevent context overflow
export const OUTPUT_LIMITS = {
  read_file: {
    maxLines: 2000,
    maxBytes: 100_000,
    maxImageBytes: 2_097_152, // 2MB for images
  },
  run_command: {
    maxLines: 2000,
    maxBytes: 50_000,
  },
  glob: {
    maxResults: 500,
  },
  grep: {
    maxMatches: 200,
  },
  web_fetch: {
    maxBytes: 100_000,
  },
}
