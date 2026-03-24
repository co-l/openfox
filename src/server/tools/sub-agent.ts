/**
 * Call Sub-Agent Tool
 *
 * Allows main agents to invoke specialized sub-agents for specific tasks.
 */

import type { Tool, ToolResult, ToolContext } from './types.js'
import type { SubAgentType } from '../sub-agents/types.js'
import { executeSubAgent } from '../sub-agents/manager.js'
import { TurnMetrics } from '../chat/stream-pure.js'

export const callSubAgentTool: Tool = {
  name: 'call_sub_agent',
  definition: {
    type: 'function',
    function: {
      name: 'call_sub_agent',
      description: 'Call a sub-agent to perform a specialized task. Available sub-agents: verifier (verify criteria), code_reviewer (review code quality), test_generator (generate tests), debugger (analyze errors). The sub-agent will execute with isolated context and return a text result.',
      parameters: {
        type: 'object',
        properties: {
          subAgentType: {
            type: 'string',
            description: 'Type of sub-agent to call',
            enum: ['verifier', 'code_reviewer', 'test_generator', 'debugger'],
          },
          prompt: {
            type: 'string',
            description: 'Task description for the sub-agent. Be specific about what you need.',
          },
        },
        required: ['subAgentType', 'prompt'],
      },
    },
  },
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()

    if (!args['subAgentType']) {
      return {
        success: false,
        error: 'Missing required parameter: subAgentType',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }

    if (!args['prompt']) {
      return {
        success: false,
        error: 'Missing required parameter: prompt',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }

    const subAgentType = args['subAgentType'] as SubAgentType
    const prompt = args['prompt'] as string

    const validTypes: SubAgentType[] = ['verifier', 'code_reviewer', 'test_generator', 'debugger']
    if (!validTypes.includes(subAgentType)) {
      return {
        success: false,
        error: `Unknown sub-agent type: ${subAgentType}. Available types: ${validTypes.join(', ')}`,
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }

    const { sessionId, sessionManager, llmClient, statsIdentity } = context

    if (!sessionId || !sessionManager || !llmClient) {
      return {
        success: false,
        error: 'Missing required context: sessionId, sessionManager, or llmClient',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }

    try {
      // Build per-subagent tool registry from the registry definition
      const { getToolRegistryForSubAgent } = await import('../tools/index.js')
      const { createSubAgentRegistry } = await import('../sub-agents/registry.js')
      const registry = createSubAgentRegistry()
      const toolNames = registry.getToolRegistry(subAgentType)
      const toolRegistry = getToolRegistryForSubAgent(toolNames)

      const turnMetrics = new TurnMetrics()

      const result = await executeSubAgent({
        subAgentType,
        prompt,
        sessionManager,
        sessionId,
        llmClient,
        toolRegistry,
        turnMetrics,
        statsIdentity: statsIdentity ?? {
          providerId: 'unknown',
          providerName: 'Unknown',
          backend: 'unknown',
          model: llmClient.getModel(),
        },
        signal: context.signal,
        onMessage: context.onEvent,
      })

      return {
        success: true,
        output: result.content,
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during sub-agent execution',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }
  },
}
