/**
 * Step Done Tool
 *
 * Allows workflow agent steps to explicitly signal completion.
 * Only available during workflow execution for 'agent' type steps.
 * The workflow executor tracks when this tool is called to determine
 * whether to loop the step or proceed to transition evaluation.
 */

import type { Tool, ToolResult, ToolContext } from './types.js'

export const stepDoneTool: Tool = {
  name: 'step_done',
  definition: {
    type: 'function',
    function: {
      name: 'step_done',
      description:
        'Signal that you have completed the current workflow step. Call this exactly once when you have finished all work for this step. After calling this, no further tool calls should be made.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  async execute(_args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    return {
      success: true,
      output: 'Step completion signal recorded.',
      durationMs: 0,
      truncated: false,
    }
  },
}
