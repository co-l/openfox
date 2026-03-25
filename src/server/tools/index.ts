import type { ToolResult, ToolMode } from '../../shared/types.js'
import type { Tool, ToolRegistry, ToolContext } from './types.js'
import { readFileTool } from './read.js'
import { writeFileTool } from './write.js'
import { editFileTool } from './edit.js'
import { runCommandTool } from './shell.js'
import { globTool } from './glob.js'
import { grepTool } from './grep.js'
import { gitTool } from './git.js'
import { askUserTool, AskUserInterrupt, provideAnswer, cancelQuestion } from './ask.js'
import {
  PathAccessDeniedError,
  providePathConfirmation,
  cancelPathConfirmation,
} from './path-security.js'
import { completeCriterionTool, passCriterionTool, failCriterionTool } from './criterion.js'
import { getCriteriaTool, addCriterionTool, updateCriterionTool, removeCriterionTool } from './planner-criteria.js'
import { todoWriteTool, setTodoUpdateCallback, getTodos, clearTodos } from './todo.js'
import { callSubAgentTool } from './sub-agent.js'
import { loadSkillTool } from './load-skill.js'
import { returnValueTool } from './return-value.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Tool Sets by Mode
// ============================================================================

// Read-only tools available in all modes
const readOnlyTools: Tool[] = [
  readFileTool,
  globTool,
  grepTool,
]

// Planner mode: read-only exploration + criteria management + git inspection + sub-agents
const plannerTools: Tool[] = [
  ...readOnlyTools,
  runCommandTool,
  gitTool,
  getCriteriaTool,
  addCriterionTool,
  updateCriterionTool,
  removeCriterionTool,
  callSubAgentTool,
  loadSkillTool,
]

// Builder mode: full write access + criterion completion + task tracking + criteria reading + sub-agents
const builderTools: Tool[] = [
  ...readOnlyTools,
  writeFileTool,
  editFileTool,
  runCommandTool,
  askUserTool,
  completeCriterionTool,
  getCriteriaTool,
  todoWriteTool,
  callSubAgentTool,
  loadSkillTool,
]

// Verifier mode: read + run commands (for testing) + criterion pass/fail
const verifierTools: Tool[] = [
  ...readOnlyTools,
  runCommandTool,
  passCriterionTool,
  failCriterionTool,
]

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
        // Re-throw interrupts - they're not real errors, they pause execution
        if (error instanceof AskUserInterrupt) {
          throw error
        }
        // PathAccessDeniedError: user denied path access, abort the run
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

// Create mode-specific registries
const plannerRegistry = createRegistryFromTools(plannerTools)
const builderRegistry = createRegistryFromTools(builderTools)
const verifierRegistry = createRegistryFromTools(verifierTools)

// All tools by name for dynamic subagent registry creation
const allToolsByName = new Map<string, Tool>([
  ...[
    readFileTool, writeFileTool, editFileTool, runCommandTool,
    globTool, grepTool, gitTool, askUserTool,
    completeCriterionTool, passCriterionTool, failCriterionTool,
    getCriteriaTool, addCriterionTool, updateCriterionTool, removeCriterionTool,
    todoWriteTool, callSubAgentTool, loadSkillTool, returnValueTool,
  ].map(t => [t.name, t] as const),
])

/**
 * Get the tool registry for a specific mode
 */
export function getToolRegistryForMode(mode: ToolMode): ToolRegistry {
  switch (mode) {
    case 'planner':
      return plannerRegistry
    case 'builder':
      return builderRegistry
    case 'verifier':
      return verifierRegistry
  }
}

/**
 * Create a tool registry for a subagent from a list of tool names.
 * Used by SubAgentManager to give each subagent type its own tool set.
 */
export function getToolRegistryForSubAgent(toolNames: string[]): ToolRegistry {
  const tools: Tool[] = []
  for (const name of toolNames) {
    const tool = allToolsByName.get(name)
    if (tool) {
      tools.push(tool)
    }
  }
  // Always include return_value — it's part of the default subagent toolkit
  if (!tools.some(t => t.name === 'return_value')) {
    const rv = allToolsByName.get('return_value')
    if (rv) tools.push(rv)
  }
  return createRegistryFromTools(tools)
}

/**
 * Create a generic tool registry (all tools) - for backward compatibility
 */
export function createToolRegistry(): ToolRegistry {
  return builderRegistry
}

// Re-export types and utilities
export type { Tool, ToolRegistry, ToolContext } from './types.js'
export { AskUserInterrupt, provideAnswer, cancelQuestion, cancelQuestionsForSession } from './ask.js'
export { setTodoUpdateCallback, getTodos, clearTodos } from './todo.js'
export {
  PathAccessDeniedError,
  providePathConfirmation,
  cancelPathConfirmation,
  cancelPathConfirmationsForSession,
  addAllowedPaths,
  clearAllowedPaths,
  requestPathAccess,
} from './path-security.js'
