/**
 * Call Sub-Agent Tool
 * 
 * Allows main agents to invoke specialized sub-agents for specific tasks.
 */

import type { Tool, ToolResult, ToolContext } from './types.js'
import type { SubAgentType } from '../sub-agents/types.js'
import { createSubAgentManager } from '../sub-agents/manager.js'
import type { LLMClientWithModel } from '../llm/client.js'

// Extend ToolContext to include LLM client for sub-agent execution
interface SubAgentToolContext extends ToolContext {
  llmClient: LLMClientWithModel
}

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
    
    // Validate arguments
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

    // Validate sub-agent type
    const validTypes: SubAgentType[] = ['verifier', 'code_reviewer', 'test_generator', 'debugger']
    if (!validTypes.includes(subAgentType)) {
      return {
        success: false,
        error: `Unknown sub-agent type: ${subAgentType}. Available types: ${validTypes.join(', ')}`,
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }

    try {
      // Create sub-agent manager
      const subAgentManager = createSubAgentManager()
      
      // Get session and LLM client from context
      const sessionId = context.sessionId
      const sessionManager = context.sessionManager
      const llmClient = (context as SubAgentToolContext).llmClient

      if (!sessionId || !sessionManager || !llmClient) {
        return {
          success: false,
          error: 'Missing required context: sessionId, sessionManager, or llmClient',
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }

      // For now, use verifier tool registry for all sub-agents
      // In the future, each sub-agent type should have its own tool registry
      // We'll need to import getToolRegistryForMode here, but that would create circular dependency
      // So we'll pass the verifier registry which has the necessary tools
      const { getToolRegistryForMode } = await import('../tools/index.js')
      const toolRegistry = getToolRegistryForMode('verifier')

      // Execute sub-agent
      const result = await subAgentManager.executeSubAgent(
        subAgentType,
        prompt,
        sessionManager,
        sessionId,
        llmClient,
        toolRegistry
      )

      return {
        success: true,
        output: result,
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
