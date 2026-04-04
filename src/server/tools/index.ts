import type { ToolResult } from '../../shared/types.js'
import type { Tool, ToolRegistry, ToolContext } from './types.js'
import type { AgentDefinition } from '../agents/types.js'
import { readFileTool } from './read.js'
import { writeFileTool } from './write.js'
import { editFileTool } from './edit.js'
import { runCommandTool } from './shell.js'
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
// Granular Tool Permissions
// ============================================================================

/**
 * Parse granular tool permissions from allowedTools.
 * Format: "criterion:pass,fail" or "criterion" (all actions)
 * Returns: { toolName: Set<actions> }
 */
export function parseToolPermissions(allowedTools: string[]): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {}

  for (const entry of allowedTools) {
    const colonIdx = entry.indexOf(':')
    if (colonIdx === -1) {
      // No granular permissions - tool name only
      // Empty Set means ALL actions allowed
      result[entry] = new Set()
    } else {
      const toolName = entry.slice(0, colonIdx)
      const actionsStr = entry.slice(colonIdx + 1)
      const actions = actionsStr.split(',').filter(Boolean)
      result[toolName] = new Set(actions)
    }
  }

  return result
}

/**
 * Check if an action is permitted for a tool.
 * Returns undefined if no restrictions (all actions allowed).
 * Returns the Set of allowed actions if there are restrictions.
 */
export function getToolPermissions(
  toolName: string,
  permissions: Record<string, Set<string>>
): Set<string> | undefined {
  const perms = permissions[toolName]
  if (!perms || perms.size === 0) {
    // No granular permissions - all actions allowed
    return undefined
  }
  return perms
}

/**
 * Validate an action against tool permissions.
 * Returns error message if not permitted, undefined if allowed.
 */
export function validateToolAction(
  toolName: string,
  action: string,
  permissions: Record<string, Set<string>>
): string | undefined {
  const perms = permissions[toolName]
  if (!perms || perms.size === 0) {
    // No granular permissions - all actions allowed
    return undefined
  }
  if (!perms.has(action)) {
    return `Action '${action}' not allowed. Available: ${[...perms].join(', ')}`
  }
  return undefined
}

// ============================================================================
// Registry Creation
// ============================================================================

export function createRegistryFromTools(
  tools: Tool[],
  allowedTools?: string[],
  toolPermissions?: Record<string, Set<string>>
): ToolRegistry {
  const toolMap = new Map<string, Tool>()
  const allowedToolsSet = new Set(allowedTools || [])

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

      // Check base tool permission (considering granular permissions like "criterion:pass,fail")
      const hasBaseToolPermission = allowedToolsSet.has(name) || [...allowedToolsSet].some(entry => entry.startsWith(`${name}:`))
      if (allowedTools && allowedTools.length > 0 && !hasBaseToolPermission) {
        logger.debug('Permission denied: tool not in allowed list', {
          tool: name,
          allowedTools,
        })
        return {
          success: false,
          error: createPermissionErrorMessage(name, allowedTools),
          durationMs: 0,
          truncated: false,
        }
      }

      // Check granular action permission if applicable
      if (toolPermissions) {
        // Extract action from args (for tools like criterion that have an 'action' param)
        const action = args['action'] as string | undefined
        if (action) {
          const actionError = validateToolAction(name, action, toolPermissions)
          if (actionError) {
            logger.debug('Permission denied: action not allowed', {
              tool: name,
              action,
              toolPermissions,
            })
            return {
              success: false,
              error: actionError,
              durationMs: 0,
              truncated: false,
            }
          }
        }
      }

      // Inject permittedActions into context for tools to use (convert Sets to arrays)
      const permittedActionsArray: Record<string, string[]> = {}
      for (const [key, value] of Object.entries(toolPermissions || {})) {
        permittedActionsArray[key] = [...value]
      }
      const contextWithPerms: ToolContext = {
        ...context,
        permittedActions: Object.keys(permittedActionsArray).length > 0 ? permittedActionsArray : undefined,
      }

      logger.debug('Executing tool', { tool: name, args })

      try {
        const result = await tool.execute(args, contextWithPerms)

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
      askUserTool,
      criterionTool,
      todoTool, callSubAgentTool, loadSkillTool, returnValueTool, webFetchTool,
      devServerTool, stepDoneTool,
    ].map(t => [t.name, t] as const),
  ])
}

/**
 * Creates a permission error message for unauthorized tool access
 */
function createPermissionErrorMessage(
  toolName: string,
  allowedTools: string[]
): string {
  if (allowedTools.length === 0) {
    return `Tool '${toolName}' is not in your allowed tools list. No tools are allowed.`
  }
  return `Tool '${toolName}' is not in your allowed tools list. Available: ${allowedTools.join(', ')}`
}

/**
 * Adds return_value to allowed tools list if not already present
 */
function addReturnValueToAllowedTools(allowedTools: string[]): string[] {
  if (!allowedTools.includes('return_value')) {
    return [...allowedTools, 'return_value']
  }
  return allowedTools
}

// ============================================================================
// Agent-Based Registry Creation
// ============================================================================

/**
 * Create a tool registry for a subagent from a list of tool names.
 * Sub-agents automatically get return_value added.
 * Supports granular permissions: "criterion:pass,fail"
 */
export function getToolRegistryForSubAgent(toolNames: string[]): ToolRegistry {
  const allTools = getAllToolsMap()
  const tools: Tool[] = []

  // Parse granular tool permissions
  const toolPermissions = parseToolPermissions(toolNames)

  for (const name of toolNames) {
    // Extract base tool name (before colon)
    const baseName = name.includes(':') ? name.split(':')[0]! : name
    const tool = allTools.get(baseName)
    if (tool) {
      tools.push(tool)
    } else {
      logger.warn(`Unknown tool '${baseName}' in sub-agent allowedTools list`)
    }
  }
  if (!tools.some(t => t.name === 'return_value')) {
    const rv = allTools.get('return_value')
    if (rv) tools.push(rv)
  }
  const allowedToolsWithReturnValue = addReturnValueToAllowedTools(toolNames)
  return createRegistryFromTools(tools, allowedToolsWithReturnValue, toolPermissions)
}

/**
 * Create a tool registry for an agent definition.
 * 
 * For top-level agents (subagent: false):
 *   - Returns ALL tools to ensure vLLM prefix cache consistency across mode switches
 *   - The allowedTools list is ignored for tool filtering
 *   - return_value is excluded (top-level agents finish with chat.done, not return_value)
 * 
 * For sub-agents (subagent: true):
 *   - Filters tools based on allowedTools list
 *   - return_value is automatically added
 *   - Sub-agents have isolated contexts, so filtering is safe
 * 
 * Logs warnings for unknown tool names.
 */
export function getToolRegistryForAgent(agentDef: AgentDefinition): ToolRegistry {
  if (agentDef.metadata.subagent) {
    return getToolRegistryForSubAgent(agentDef.metadata.allowedTools)
  }
  
  // Top-level agents: return ALL tools for vLLM cache consistency
  const allTools = getAllToolsMap()
  const tools: Tool[] = []
  const allowedTools: string[] = []
  
  for (const [name, tool] of allTools.entries()) {
    // Exclude return_value from top-level agents
    if (name === 'return_value') {
      continue
    }
    tools.push(tool)
    allowedTools.push(name)
  }
  
  return createRegistryFromTools(tools, allowedTools)
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
