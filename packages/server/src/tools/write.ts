import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, isAbsolute, dirname } from 'node:path'
import type { ToolResult, Diagnostic } from '@openfox/shared'
import type { Tool, ToolContext } from './types.js'
import { formatDiagnosticsForLLM } from './diagnostics.js'

export const writeFileTool: Tool = {
  name: 'write_file',
  definition: {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, or overwrites if it does. Creates parent directories as needed.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (relative to workdir or absolute)',
          },
          content: {
            type: 'string',
            description: 'Content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const path = args['path'] as string
      const content = args['content'] as string
      
      // Resolve path
      const fullPath = isAbsolute(path) ? path : resolve(context.workdir, path)
      
      // Ensure parent directory exists
      const dir = dirname(fullPath)
      await mkdir(dir, { recursive: true })
      
      // Write file
      await writeFile(fullPath, content, 'utf-8')
      
      const lineCount = content.split('\n').length
      const byteCount = Buffer.byteLength(content, 'utf-8')
      
      let output = `Successfully wrote ${lineCount} lines (${byteCount} bytes) to ${path}`
      let diagnostics: Diagnostic[] = []
      
      // Get LSP diagnostics if available
      if (context.lspManager) {
        diagnostics = await context.lspManager.notifyFileChange(fullPath, content)
        output += formatDiagnosticsForLLM(diagnostics)
      }
      
      return {
        success: true,
        output,
        durationMs: Date.now() - startTime,
        truncated: false,
        ...(diagnostics.length > 0 && { diagnostics }),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error writing file',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }
  },
}
