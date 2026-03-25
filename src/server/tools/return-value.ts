/**
 * Return Value Tool
 *
 * Allows sub-agents to explicitly set a structured return value
 * that gets passed back to the calling agent. The sub-agent manager
 * intercepts calls to this tool and captures the content.
 */

import type { Tool, ToolResult, ToolContext } from './types.js'

export const returnValueTool: Tool = {
  name: 'return_value',
  definition: {
    type: 'function',
    function: {
      name: 'return_value',
      description:
        'Set the return value for this sub-agent execution. Call this once at the end of your work with a structured summary of your findings. The content will be passed back to the calling agent.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description:
              'The return value content — a structured summary of findings, results, or recommendations',
          },
        },
        required: ['content'],
      },
    },
  },
  async execute(_args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    return {
      success: true,
      output: 'Return value recorded.',
      durationMs: 0,
      truncated: false,
    }
  },
}
