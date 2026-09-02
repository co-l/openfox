import type { Tool, ToolContext } from '../tools/types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { McpManager } from './manager.js'
import type { ToolResult } from '../../shared/types.js'
import { sanitizeToolSchema } from '../llm/schema-sanitizer.js'

export function createMcpTools(mcpManager: McpManager): Tool[] {
  const tools: Tool[] = []

  for (const server of mcpManager.getAllServers()) {
    for (const mcpTool of server.tools) {
      if (!mcpTool.enabled) continue

      const prefixedName = `${server.name}_${mcpTool.name}`

      const definition: LLMToolDefinition = {
        type: 'function',
        function: {
          name: prefixedName,
          description: mcpTool.description ?? '',
          parameters: sanitizeToolSchema(mcpTool.inputSchema as Record<string, unknown>),
        },
      }

      tools.push({
        name: prefixedName,
        definition,
        mcpServer: server.name,
        execute: async (args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> => {
          const start = Date.now()
          const normalizedArgs = { ...args }
          if ('props' in normalizedArgs && !('properties' in normalizedArgs)) {
            normalizedArgs['properties'] = normalizedArgs['props']
            delete normalizedArgs['props']
          }
          const result = await mcpManager.callTool(server.name, mcpTool.name, normalizedArgs)
          return {
            success: result.success,
            ...(result.output ? { output: result.output } : {}),
            ...(result.error ? { error: result.error } : {}),
            durationMs: Date.now() - start,
            truncated: false,
          }
        },
      })
    }
  }

  return tools
}
