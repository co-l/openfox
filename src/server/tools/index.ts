import type { ToolResult } from '../../shared/types.js'
import type { Tool, ToolRegistry, ToolContext } from './types.js'
import type { AgentDefinition } from '../agents/types.js'
import { readFileTool } from './read.js'
import { writeFileTool } from './write.js'
import { editFileTool } from './edit.js'
import { runCommandTool } from './shell.js'
import { globTool } from './glob.js'
import { grepTool } from './grep.js'
import { gitTool } from './git.js'
import { askUserTool, AskUserInterrupt } from './ask.js'
import {
  PathAccessDeniedError,
  requestPathAccess,
} from './path-security.js'
import { criterionTool } from './criterion.js'
import { todoTool } from './todo.js'
import { callSubAgentTool } from './sub-agent.js'
import { loadSkillTool } from './load-skill.js'
import { returnValueTool } from './return-value.js'
import { webFetchTool } from './web-fetch.js'
import { devServerTool } from './dev-server.js'
import { stepDoneTool } from './step-done.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Registry Creation
// ============================================================================

function createRegistryFromTools(tools: Tool[]): ToolRegistry {
  const toolMap = new Map<string, Tool>()

  for (const tool of tools) {
    toolMap.set(tool.name, tool)
  }

  return {
    tools,
    definitions: tools.map(t => t.definition),

    async execute(
      name: string,
      args: Record<string, unknown>,
      context: ToolContext
    ): Promise<ToolResult> {
      const tool = toolMap.get(name)

      if (!tool) {
        return {
          success: false,
          error: `Unknown tool: ${name}. Available tools: ${tools.map(t => t.name).join(', ')}`,
          durationMs: 0,
          truncated: false,
        }
      }

      logger.debug('Executing tool', { tool: name, args })

      try {
        const result = await tool.execute(args, context)

        logger.debug('Tool completed', {
          tool: name,
          success: result.success,
          durationMs: result.durationMs,
        })

        return result
      } catch (error) {
        if (error instanceof AskUserInterrupt) {
          throw error
        }
        if (error instanceof PathAccessDeniedError) {
          throw error
        }

        logger.error('Tool execution error', { tool: name, error })

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          durationMs: 0,
          truncated: false,
        }
      }
    },
  }
}

// All tools by name for dynamic registry creation
// Lazy initialization to avoid circular dependency issues during module load
function getAllToolsMap(): Map<string, Tool> {
  return new Map<string, Tool>([
    ...[
      readFileTool, writeFileTool, editFileTool, runCommandTool,
      globTool, grepTool, gitTool, askUserTool,
      criterionTool, todoTool, callSubAgentTool, loadSkillTool, returnValueTool, webFetchTool,
      devServerTool, stepDoneTool,
    ].map(t => [t.name, t] as const),
  ])
}

// ============================================================================
// Agent-Based Registry Creation
// ============================================================================

/**
 * Create a tool registry for a subagent from a list of tool names.
 * Sub-agents automatically get return_value added.
 */
export function getToolRegistryForSubAgent(toolNames: string[]): ToolRegistry {
  const allTools = getAllToolsMap()
  const tools: Tool[] = []
  for (const name of toolNames) {
    const tool = allTools.get(name)
    if (tool) {
      tools.push(tool)
    }
  }
  if (!tools.some(t => t.name === 'return_value')) {
    const rv = allTools.get('return_value')
    if (rv) tools.push(rv)
  }
  return createRegistryFromTools(tools)
}

/**
 * Create a tool registry for an agent definition.
 * Uses the agent's tools list to filter from the global tool registry.
 * Sub-agents automatically get return_value added.
 */
export function getToolRegistryForAgent(agentDef: AgentDefinition): ToolRegistry {
  if (agentDef.metadata.subagent) {
    return getToolRegistryForSubAgent(agentDef.metadata.tools)
  }
  const allTools = getAllToolsMap()
  const tools: Tool[] = []
  for (const name of agentDef.metadata.tools) {
    const tool = allTools.get(name)
    if (tool) {
      tools.push(tool)
    }
  }
  return createRegistryFromTools(tools)
}

/**
 * Create a generic tool registry with all available tools.
 */
export function createToolRegistry(): ToolRegistry {
  return createRegistryFromTools(Array.from(getAllToolsMap().values()))
}

// Re-export types and utilities
export type { Tool, ToolRegistry, ToolContext } from './types.js'
export { AskUserInterrupt, cancelQuestionsForSession, provideAnswer } from './ask.js'
export {
  PathAccessDeniedError,
  requestPathAccess,
  cancelPathConfirmationsForSession,
  providePathConfirmation,
} from './path-security.js'
export { stepDoneTool } from './step-done.js'
