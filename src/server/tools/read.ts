import { readFile, stat } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import type { ToolResult } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'
import { OUTPUT_LIMITS } from './types.js'
import { ToolExecutionError } from '../utils/errors.js'
import { requestPathAccess, PathAccessDeniedError } from './path-security.js'
import { computeFileHash } from './file-tracker.js'
import { sessionManager } from '../session/index.js'

export const readFileTool: Tool = {
  name: 'read_file',
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Returns the file content with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (relative to workdir or absolute)',
          },
          offset: {
            type: 'number',
            description: 'Line number to start from (1-indexed). Default: 1',
          },
          limit: {
            type: 'number',
            description: `Maximum number of lines to read. Default: ${OUTPUT_LIMITS.read_file.maxLines}`,
          },
        },
        required: ['path'],
      },
    },
  },
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const path = args['path'] as string
      const offset = (args['offset'] as number | undefined) ?? 1
      const limit = Math.min(
        (args['limit'] as number | undefined) ?? OUTPUT_LIMITS.read_file.maxLines,
        OUTPUT_LIMITS.read_file.maxLines
      )
      
      // Resolve path
      const fullPath = isAbsolute(path) ? path : resolve(context.workdir, path)
      
      // Check sandbox - request confirmation for paths outside workdir
      if (context.onEvent) {
        await requestPathAccess(
          [fullPath],
          context.workdir,
          context.sessionId,
          crypto.randomUUID(),
          'read_file',
          context.onEvent
        )
      }
      
      // Check if file exists
      try {
        const stats = await stat(fullPath)
        if (stats.isDirectory()) {
          return {
            success: false,
            error: `Path is a directory, not a file: ${path}`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
      } catch {
        return {
          success: false,
          error: `File not found: ${path}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      // Read file
      const content = await readFile(fullPath, 'utf-8')
      const lines = content.split('\n')
      const totalLines = lines.length
      
      // Apply offset and limit
      const startLine = Math.max(1, offset)
      const endLine = Math.min(startLine + limit - 1, totalLines)
      const selectedLines = lines.slice(startLine - 1, endLine)
      
      // Format with line numbers
      const formatted = selectedLines
        .map((line, i) => `${startLine + i}: ${line}`)
        .join('\n')
      
      // Check if truncated
      const truncated = endLine < totalLines
      let output = formatted
      
      if (truncated) {
        output += `\n\n[Showing lines ${startLine}-${endLine} of ${totalLines} total. Use offset to read more.]`
      }
      
      // Check byte limit
      if (output.length > OUTPUT_LIMITS.read_file.maxBytes) {
        output = output.slice(0, OUTPUT_LIMITS.read_file.maxBytes)
        output += '\n\n[Output truncated due to size limit]'
      }
      
      // Record file read with content hash for write validation
      const contentHash = await computeFileHash(fullPath)
      if (contentHash) {
        sessionManager.recordFileRead(context.sessionId, fullPath, contentHash)
      }
      
      return {
        success: true,
        output,
        durationMs: Date.now() - startTime,
        truncated,
      }
    } catch (error) {
      // Re-throw path access errors for orchestrator to handle with helpful message
      if (error instanceof PathAccessDeniedError) {
        throw error
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error reading file',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }
  },
}
