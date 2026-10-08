/**
 * Call Sub-Agent Tool
 *
 * Allows main agents to invoke specialized sub-agents for specific tasks.
 * Resolves sub-agent definitions from the agent registry (.agent.md files).
 */

import type { Tool, ToolResult, ToolContext } from './types.js'
import type { SubAgentType } from '../sub-agents/types.js'
import { executeSubAgent } from '../sub-agents/manager.js'
import { TurnMetrics } from '../chat/stream-pure.js'
import { loadAllAgentsDefault, getSubAgents, findAgentById } from '../agents/registry.js'
import { CONTINUATION_REGEX } from '../session/sub-agent-recovery.js'
import { logger } from '../utils/logger.js'

export const callSubAgentTool: Tool = {
  name: 'call_sub_agent',
  definition: {
    type: 'function',
    function: {
      name: 'call_sub_agent',
      description:
        'Call a sub-agent to perform a specialized task. Available sub-agents: verifier (verify criteria), code_reviewer (review code quality), explorer (explore codebase). The sub-agent will execute with isolated context and return a text result. To resume an interrupted sub-agent without losing its work, provide its subAgentId.',
      parameters: {
        type: 'object',
        properties: {
          subAgentType: {
            type: 'string',
            description: 'Type of sub-agent to call',
          },
          prompt: {
            type: 'string',
            description: 'Task description for the sub-agent. Be specific about what you need.',
          },
          subAgentId: {
            type: 'string',
            description:
              'Optional ID of an existing sub-agent to resume. When provided, the sub-agent resumes where it left off, retaining all previous context, findings, and history, instead of starting from scratch.',
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

    const subAgentType = args['subAgentType'] as string
    const prompt = args['prompt'] as string
    let subAgentId = (args['subAgentId'] as string | undefined)?.trim() || undefined

    // Resolve agent definition from the registry (built-in + user-defined)
    const agents = await loadAllAgentsDefault()
    const agentDef = findAgentById(subAgentType, agents)

    if (!agentDef || !agentDef.metadata.subagent) {
      const validIds = getSubAgents(agents).map((a) => a.metadata.id)
      return {
        success: false,
        error: `Unknown sub-agent type: ${subAgentType}. Available types: ${validIds.join(', ')}`,
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }

    const { sessionId, sessionManager, llmClient, statsIdentity, providerManager } = context

    if (!sessionId || !sessionManager || !llmClient) {
      return {
        success: false,
        error: 'Missing required context: sessionId, sessionManager, or llmClient',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }

    let isResuming = Boolean(subAgentId)
    let autoResumed = false

    if (!subAgentId) {
      const lastInterrupted = sessionManager.getLastInterruptedSubAgentForType(sessionId, subAgentType)
      if (lastInterrupted && CONTINUATION_REGEX.test(prompt)) {
        subAgentId = lastInterrupted.subAgentId
        isResuming = true
        autoResumed = true
        logger.info('Auto-resuming interrupted sub-agent based on continuation prompt', {
          subAgentType,
          subAgentId,
        })
      }
    }

    subAgentId = subAgentId ?? crypto.randomUUID()

    try {
      // Build tool registry from the agent definition's allowedTools list
      const { getToolRegistryForAgent } = await import('../tools/index.js')
      const toolRegistry = getToolRegistryForAgent(agentDef)

      const turnMetrics = new TurnMetrics()

      const result = await executeSubAgent({
        subAgentType: subAgentType as SubAgentType,
        prompt,
        subAgentId,
        isResuming,
        sessionManager,
        sessionId,
        llmClient,
        toolRegistry,
        turnMetrics,
        providerManager,
        statsIdentity: statsIdentity ?? {
          providerId: 'unknown',
          providerName: 'Unknown',
          backend: 'unknown',
          model: llmClient.getModel(),
        },
        ...(context.signal ? { signal: context.signal } : {}),
        ...(context.onEvent ? { onMessage: context.onEvent } : {}),
      })

      sessionManager.clearInterruptedSubAgent(sessionId, subAgentId)

      return {
        success: true,
        output: result.content,
        durationMs: Date.now() - startTime,
        truncated: false,
        // Surface an implicit resume so the caller/model knows a prior
        // interrupted context was reattached rather than a fresh start.
        ...(autoResumed ? { metadata: { autoResumed: true, subAgentId, subAgentType } } : {}),
      }
    } catch (error) {
      sessionManager.recordInterruptedSubAgent(sessionId, {
        subAgentId,
        subAgentType,
        prompt,
        interruptedAt: Date.now(),
      })
      const isInterrupted =
        context.signal?.aborted ||
        (error instanceof Error && (error.message === 'Aborted' || error.name === 'AbortError'))
      const errorMessage = isInterrupted
        ? `Sub-agent '${subAgentType}' (id: '${subAgentId}') was interrupted before finishing. Its context and progress have been preserved. To resume this sub-agent without losing its work, call call_sub_agent with subAgentId: '${subAgentId}' and prompt: 'Continue where you left off'. Do NOT relaunch a new sub-agent from scratch.`
        : error instanceof Error
          ? error.message
          : 'Unknown error during sub-agent execution'
      return {
        success: false,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        truncated: false,
        metadata: {
          ...(isInterrupted ? { interrupted: true } : {}),
          subAgentId,
          subAgentType,
        },
      }
    }
  },
}
