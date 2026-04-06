import { resolve, isAbsolute } from 'node:path'
import type { ToolResult } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import { requestPathAccess, PathAccessDeniedError } from './path-security.js'

/**
 * Helper utilities provided to tool handlers by createTool.
 * These encapsulate common patterns like path resolution and result formatting.
 */
export interface ToolHelpers {
  /** Resolve a path relative to workdir (or return as-is if absolute) */
  resolvePath: (path: string) => string
  
  /** Check path access and request user confirmation if needed. Throws PathAccessDeniedError if denied. */
  checkPathAccess: (paths: string[]) => Promise<void>
  
  /** Create an error result with timing */
  error: (message: string, truncated?: boolean) => ToolResult
  
  /** Create a success result with timing */
  success: (output: string, truncated?: boolean, extra?: Partial<ToolResult>) => ToolResult
}

/**
 * Handler function type for tools created with createTool.
 * Receives typed args, context, and helper utilities.
 */
export type ToolHandler<TArgs> = (
  args: TArgs,
  context: ToolContext,
  helpers: ToolHelpers
) => Promise<ToolResult>

/**
 * Create a tool with common boilerplate handled automatically:
 * - Timing (durationMs)
 * - Error handling with PathAccessDeniedError re-throw
 * - Path resolution helper
 * - Success/error result helpers
 * 
 * @param name - Tool name
 * @param definition - LLM tool definition
 * @param handler - Tool implementation receiving typed args and helpers
 * @returns Tool object ready for registration
 * 
 * @example
 * ```ts
 * interface ReadFileArgs { path: string; offset?: number }
 * 
 * export const readFileTool = createTool<ReadFileArgs>(
 *   'read_file',
 *   definition,
 *   async (args, context, helpers) => {
 *     const fullPath = helpers.resolvePath(args.path)
 *     await helpers.checkPathAccess([fullPath])
 *     const content = await readFile(fullPath, 'utf-8')
 *     return helpers.success(content)
 *   }
 * )
 * ```
 */
export function createTool<TArgs>(
  name: string,
  definition: LLMToolDefinition,
  handler: ToolHandler<TArgs>
): Tool {
  return {
    name,
    definition,
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const startTime = Date.now()
      
      // Create helpers with timing closure
      const helpers: ToolHelpers = {
        resolvePath: (path: string) => 
          isAbsolute(path) ? path : resolve(context.workdir, path),
        
        checkPathAccess: async (paths: string[]) => {
          if (context.onEvent) {
            await requestPathAccess(
              paths,
              context.workdir,
              context.sessionId,
              crypto.randomUUID(),
              name,
              context.onEvent,
              context.dangerLevel
            )
          }
        },
        
        error: (message: string, truncated = false) => ({
          success: false,
          error: message,
          durationMs: Date.now() - startTime,
          truncated,
        }),
        
        success: (output: string, truncated = false, extra?: Partial<ToolResult>) => ({
          success: true,
          output,
          durationMs: Date.now() - startTime,
          truncated,
          ...extra,
        }),
      }
      
      try {
        return await handler(args as TArgs, context, helpers)
      } catch (error) {
        // Re-throw path access errors for orchestrator to handle with helpful message
        if (error instanceof PathAccessDeniedError) {
          throw error
        }
        
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error in tool execution',
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
    },
  }
}
