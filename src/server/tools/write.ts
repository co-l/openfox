import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, isAbsolute, dirname } from 'node:path'
import type { ToolResult, Diagnostic } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'
import { formatDiagnosticsForLLM } from './diagnostics.js'
import { requestPathAccess } from './path-security.js'
import { validateFileForWrite, computeFileHash } from './file-tracker.js'
import { sessionManager } from '../session/index.js'

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
      
      // Check sandbox - request confirmation for paths outside workdir
      if (context.onEvent) {
        await requestPathAccess(
          [fullPath],
          context.workdir,
          context.sessionId,
          crypto.randomUUID(),
          'write_file',
          context.onEvent
        )
      }
      
      // Validate file was read before writing (only for existing files)
      const readFiles = sessionManager.getReadFiles(context.sessionId)
      const validation = await validateFileForWrite(fullPath, readFiles)
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error?.message ?? 'File validation failed',
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
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
      
      // Update file hash after write so subsequent writes don't require re-reading
      const newHash = await computeFileHash(fullPath)
      if (newHash) {
        sessionManager.updateFileHash(context.sessionId, fullPath, newHash)
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
