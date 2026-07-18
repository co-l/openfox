import type { ToolResult } from '../../shared/types.js'
import type { Tool, ToolRegistry, ToolContext } from './types.js'
import type { AgentDefinition } from '../agents/types.js'
import { readFileTool } from './read.js'
import { writeFileTool } from './write.js'
import { editFileTool } from './edit.js'
import { runCommandTool } from './shell.js'
import { askUserTool, AskUserInterrupt } from './ask.js'
import { PathAccessDeniedError } from './path-security.js'
import { sessionMetadataTool } from './session-metadata.js'
import { callSubAgentTool } from './sub-agent.js'
import { loadSkillTool } from './load-skill.js'
import { returnValueTool } from './return-value.js'
import { webFetchTool } from './web-fetch.js'
import { devServerTool } from './dev-server.js'
import { stepDoneTool } from './step-done.js'
import { backgroundProcessTool } from './background-process/index.js'
import { mcpConfigTool } from './mcp-config.js'
import { webSearchTool } from './web-search.js'
import { workspaceTool } from './workspace.js'
import { computeEffectiveTools } from './tool-policy.js'
import { loadAllAgentsDefault, findAgentById } from '../agents/registry.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Built-in Tool Registry
// ============================================================================

/**
 * All built-in tools. This is the single source of truth — both
 * BUILT_IN_TOOL_NAMES and getAllToolsMap() derive from it.
 * MCP tools are dynamic and injected separately via setMcpTools().
 *
 * Lazy initialization to avoid circular dependency issues during module load
 * (mcpConfigTool imports from ../chat/dynamic-context.js which may trigger
 *  re-entrant module evaluation).
 */
let _builtInTools: Tool[] | undefined

function getBuiltInTools(): Tool[] {
  if (!_builtInTools) {
    _builtInTools = [
      readFileTool,
      writeFileTool,
      editFileTool,
      runCommandTool,
      askUserTool,
      sessionMetadataTool,
      callSubAgentTool,
      loadSkillTool,
      returnValueTool,
      webFetchTool,
      webSearchTool,
      devServerTool,
      stepDoneTool,
      backgroundProcessTool,
      mcpConfigTool,
      workspaceTool,
    ]
  }
  return _builtInTools
}

function getBuiltInToolNames(): Set<string> {
  if (BUILT_IN_TOOL_NAMES_CACHE.size === 0) {
    for (const t of getBuiltInTools()) {
      BUILT_IN_TOOL_NAMES_CACHE.add(t.name)
    }
  }
  return BUILT_IN_TOOL_NAMES_CACHE
}

const BUILT_IN_TOOL_NAMES_CACHE = new Set<string>()

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
  permissions: Record<string, Set<string>>,
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
  permissions: Record<string, Set<string>>,
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

/**
 * Extract a prompt string from tool call arguments, trying common keys.
 * Only explicit keys are checked — no fallback loop to avoid picking up
 * unrelated string fields like subAgentType.
 */
function extractSubAgentPrompt(args: Record<string, unknown>): string {
  return (args['prompt'] as string) || (args['query'] as string) || (args['task'] as string) || ''
}

export function createRegistryFromTools(
  tools: Tool[],
  allowedTools?: string[],
  toolPermissions?: Record<string, Set<string>>,
  agentId?: string,
  isSubAgent?: boolean,
): ToolRegistry {
  const toolMap = new Map<string, Tool>()

  for (const tool of tools) {
    toolMap.set(tool.name, tool)
  }

  /**
   * Try to resolve a tool name as a sub-agent alias.
   * If the name matches a registered sub-agent ID, transforms the call
   * into a call_sub_agent invocation. This is an explicit dispatch stage,
   * not a fallback — it handles models that call sub-agent names directly
   * (e.g., "explorer") instead of using call_sub_agent(subAgentType: "explorer", ...).
   */
  async function trySubAgentAlias(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult | null> {
    if (!toolMap.has('call_sub_agent')) {
      return null
    }

    try {
      const agents = await loadAllAgentsDefault()
      const agentDef = findAgentById(name, agents)
      if (!agentDef?.metadata.subagent) {
        return null
      }

      const prompt = extractSubAgentPrompt(args)
      logger.info('Sub-agent alias transformation', {
        from: name,
        to: 'call_sub_agent',
        subAgentType: name,
      })
      return callSubAgentTool.execute({ subAgentType: name, prompt }, context)
    } catch (err) {
      logger.warn('Sub-agent alias resolution failed', {
        tool: name,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  return {
    tools,
    definitions: tools.map((t) => t.definition),

    async execute(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const tool = toolMap.get(name)

      if (tool) {
        // MCP tools are user-configured and always allowed for top-level agents
        const isMcpTool = !getBuiltInToolNames().has(name)

        // allowedTools === undefined → no restrictions (all tools allowed)
        // allowedTools === [...] → only effective tools + MCP tools allowed
        const hasRestrictions = allowedTools !== undefined

        if (!isMcpTool && hasRestrictions) {
          const effectiveTools = computeEffectiveTools(allowedTools!, isSubAgent ? 'sub-agent' : 'agent')
          if (!effectiveTools.has(name)) {
            logger.debug('Permission denied: tool not in allowed list', {
              tool: name,
              allowedTools,
            })
            return {
              success: false,
              error: createPermissionErrorMessage(name, allowedTools, agentId, isSubAgent),
              durationMs: 0,
              truncated: false,
            }
          }
        }

        // Check granular action permission if applicable
        if (toolPermissions) {
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

        // Inject permittedActions into context for tools to use
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
      }

      // Stage 2: Explicit sub-agent alias transformation
      const aliasResult = await trySubAgentAlias(name, args, context)
      if (aliasResult) return aliasResult

      // Stage 3: Unknown tool
      return {
        success: false,
        error: `Unknown tool: ${name}. Available tools: ${tools.map((t) => t.name).join(', ')}`,
        durationMs: 0,
        truncated: false,
      }
    },
  }
}

// All tools by name for dynamic registry creation
// Lazy initialization to avoid circular dependency issues during module load
let mcpToolsOverride: Tool[] = []

export function setMcpTools(tools: Tool[]): void {
  mcpToolsOverride = tools
}

function getAllToolsMap(): Map<string, Tool> {
  const builtInEntries: [string, Tool][] = getBuiltInTools().map((t) => [t.name, t])
  const mcpEntries: [string, Tool][] = mcpToolsOverride.map((t) => [t.name, t])
  return new Map<string, Tool>([...builtInEntries, ...mcpEntries])
}

/**
 * Creates a permission error message for unauthorized tool access
 */
function createPermissionErrorMessage(
  toolName: string,
  allowedTools: string[],
  agentId?: string,
  isSubAgent?: boolean,
): string {
  const effectiveTools = computeEffectiveTools(allowedTools, isSubAgent ? 'sub-agent' : 'agent')
  const available = [...effectiveTools].sort()
  if (agentId) {
    return `Tool '${toolName}' is not available in '${agentId}' mode. Available: ${available.join(', ')}`
  }
  if (available.length === 0) {
    return `Tool '${toolName}' is not in your allowed tools list. No tools are allowed.`
  }
  return `Tool '${toolName}' is not in your allowed tools list. Available: ${available.join(', ')}`
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
  if (!tools.some((t) => t.name === 'return_value')) {
    const rv = allTools.get('return_value')
    if (rv) tools.push(rv)
  }
  const allowedToolsWithReturnValue = addReturnValueToAllowedTools(toolNames)
  return createRegistryFromTools(tools, allowedToolsWithReturnValue, toolPermissions, undefined, true)
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

  // Top-level agents: return ALL tool definitions for vLLM cache consistency
  // but enforce the agent's allowedTools for execution permission
  const allTools = getAllToolsMap()
  const tools: Tool[] = []

  for (const [name, tool] of allTools.entries()) {
    // Exclude return_value from top-level agents
    if (name === 'return_value') {
      continue
    }
    tools.push(tool)
  }

  const allowedTools = agentDef.metadata.allowedTools
  const toolPermissions = parseToolPermissions(allowedTools)
  return createRegistryFromTools(tools, allowedTools, toolPermissions, agentDef.metadata.id, false)
}

/**
 * Create a generic tool registry with all available tools.
 */
export function createToolRegistry(): ToolRegistry {
  return createRegistryFromTools(Array.from(getAllToolsMap().values()))
}

// Re-export types and utilities
export type { Tool, ToolRegistry, ToolContext } from './types.js'
export { AskUserInterrupt, cancelQuestionsForSession, provideAnswer, getPendingQuestionsForSession } from './ask.js'
export {
  PathAccessDeniedError,
  requestPathAccess,
  cancelPathConfirmationsForSession,
  providePathConfirmation,
} from './path-security.js'
export { stepDoneTool } from './step-done.js'
