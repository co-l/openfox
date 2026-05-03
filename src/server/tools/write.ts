import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Diagnostic } from '../../shared/types.js'
import { createTool } from './tool-helpers.js'
import { formatDiagnosticsForLLM } from './diagnostics.js'
import { validateFileForWrite, computeFileHash } from './file-tracker.js'

interface WriteFileArgs {
  path: string
  content: string
}

export const writeFileTool = createTool<WriteFileArgs>(
  'write_file',
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write content to a file. Creates the file if it does not exist, or overwrites if it does. Creates parent directories as needed.',
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
  async (args, context, helpers) => {
    const fullPath = helpers.resolvePath(args.path)
    await helpers.checkPathAccess([fullPath])

    // Validate file was read before writing (only for existing files)
    const readFiles = context.sessionManager.getReadFiles(context.sessionId)
    const validation = await validateFileForWrite(fullPath, readFiles)
    if (!validation.valid) {
      return helpers.error(validation.error?.message ?? 'File validation failed')
    }

    // Ensure parent directory exists
    const dir = dirname(fullPath)
    await mkdir(dir, { recursive: true })

    // Write file
    await writeFile(fullPath, args.content, 'utf-8')

    const lineCount = args.content.split('\n').length
    const byteCount = Buffer.byteLength(args.content, 'utf-8')

    let output = `Successfully wrote ${lineCount} lines (${byteCount} bytes) to ${args.path}`
    let diagnostics: Diagnostic[] = []

    // Get LSP diagnostics if available
    if (context.lspManager) {
      diagnostics = await context.lspManager.notifyFileChange(fullPath, args.content)
      output += formatDiagnosticsForLLM(diagnostics)
    }

    // Update file hash after write so subsequent writes don't require re-reading
    const newHash = await computeFileHash(fullPath)
    if (newHash) {
      context.sessionManager.updateFileHash(context.sessionId, fullPath, newHash)
    }

    return helpers.success(output, false, diagnostics.length > 0 ? { diagnostics } : undefined)
  },
)
