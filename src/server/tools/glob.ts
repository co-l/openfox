import fg from 'fast-glob'
import { resolve, isAbsolute, relative } from 'node:path'
import type { ToolResult } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'
import { OUTPUT_LIMITS } from './types.js'
import { requestPathAccess } from './path-security.js'

export const globTool: Tool = {
  name: 'glob',
  definition: {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files matching a glob pattern. Returns list of matching file paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.{js,jsx}")',
          },
          cwd: {
            type: 'string',
            description: 'Base directory for the search (default: session workdir)',
          },
        },
        required: ['pattern'],
      },
    },
  },
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const pattern = args['pattern'] as string
      const cwd = args['cwd'] as string | undefined
      
      // Resolve working directory
      const baseDir = cwd 
        ? (isAbsolute(cwd) ? cwd : resolve(context.workdir, cwd))
        : context.workdir
      
      // Check sandbox - request confirmation for paths outside workdir
      if (context.onEvent) {
        await requestPathAccess(
          [baseDir],
          context.workdir,
          context.sessionId,
          crypto.randomUUID(),
          'glob',
          context.onEvent
        )
      }
      
      // Execute glob
      const files = await fg(pattern, {
        cwd: baseDir,
        onlyFiles: true,
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/.next/**',
          '**/coverage/**',
        ],
        followSymbolicLinks: false,
        suppressErrors: true,
      })
      
      // Sort by most recently modified (need to get stats for this)
      // For now, just sort alphabetically
      files.sort()
      
      // Apply limit
      const truncated = files.length > OUTPUT_LIMITS.glob.maxResults
      const limitedFiles = files.slice(0, OUTPUT_LIMITS.glob.maxResults)
      
      // Format output
      let output = limitedFiles.join('\n')
      
      if (truncated) {
        output += `\n\n[Showing first ${OUTPUT_LIMITS.glob.maxResults} of ${files.length} matches]`
      } else {
        output += `\n\n[${files.length} file(s) found]`
      }
      
      return {
        success: true,
        output,
        durationMs: Date.now() - startTime,
        truncated,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during glob',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }
  },
}
