import type { ToolResult } from '@openfox/shared'
import type { Tool, ToolRegistry, ToolContext } from './types.js'
import { readFileTool } from './read.js'
import { writeFileTool } from './write.js'
import { editFileTool } from './edit.js'
import { runCommandTool } from './shell.js'
import { globTool } from './glob.js'
import { grepTool } from './grep.js'
import { askUserTool, AskUserInterrupt, provideAnswer, cancelQuestion } from './ask.js'
import { ToolExecutionError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

// All available tools
const tools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  runCommandTool,
  globTool,
  grepTool,
  askUserTool,
]

// Create the registry
export function createToolRegistry(): ToolRegistry {
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
      
      logger.info('Executing tool', { tool: name, args })
      
      try {
        const result = await tool.execute(args, context)
        
        logger.info('Tool completed', {
          tool: name,
          success: result.success,
          durationMs: result.durationMs,
        })
        
        return result
      } catch (error) {
        // Re-throw AskUserInterrupt - it's not a real error
        if (error instanceof AskUserInterrupt) {
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

// Re-export types and utilities
export type { Tool, ToolRegistry, ToolContext } from './types.js'
export { AskUserInterrupt, provideAnswer, cancelQuestion } from './ask.js'
