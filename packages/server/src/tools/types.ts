import type { ToolResult } from '@openfox/shared'
import type { LLMToolDefinition } from '../llm/types.js'
import type { LspManagerInterface } from '../lsp/types.js'

export interface ToolContext {
  workdir: string
  sessionId: string
  onProgress?: (message: string) => void
  lspManager?: LspManagerInterface  // Optional LSP manager for file diagnostics
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
}
