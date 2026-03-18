import { readFile, stat } from 'node:fs/promises'
import { OUTPUT_LIMITS } from './types.js'
import { createTool } from './tool-helpers.js'
import { computeFileHash } from './file-tracker.js'
import { sessionManager } from '../session/index.js'

interface ReadFileArgs {
  path: string
  offset?: number
  limit?: number
}

export const readFileTool = createTool<ReadFileArgs>(
  'read_file',
  {
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
  async (args, context, helpers) => {
    const offset = args.offset ?? 1
    const limit = Math.min(
      args.limit ?? OUTPUT_LIMITS.read_file.maxLines,
      OUTPUT_LIMITS.read_file.maxLines
    )
    
    const fullPath = helpers.resolvePath(args.path)
    await helpers.checkPathAccess([fullPath])
    
    // Check if file exists and is not a directory
    try {
      const stats = await stat(fullPath)
      if (stats.isDirectory()) {
        return helpers.error(`Path is a directory, not a file: ${args.path}`)
      }
    } catch {
      return helpers.error(`File not found: ${args.path}`)
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
    
    return helpers.success(output, truncated)
  }
)
