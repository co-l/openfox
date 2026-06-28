import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Diagnostic } from '../../shared/types.js'
import { createTool } from './tool-helpers.js'
import { formatDiagnosticsForLLM, appendLspInstallHint } from './diagnostics.js'
import { validateFileForWrite, computeFileHash } from './file-tracker.js'
import { encodeContent } from '../utils/encoding.js'

interface WriteFileArgs {
  path: string
  content: string
  encoding?: string
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
          encoding: {
            type: 'string',
            description:
              'Optional file encoding (e.g. "ISO-8859-1", "windows-1252", "utf-16"). Defaults to "utf-8". Use the encoding reported by read_file to match project conventions.',
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
    const encoding = args.encoding ?? 'utf-8'
    const encoded = encodeContent(args.content, encoding)
    await writeFile(fullPath, encoded)

    const lineCount = args.content.split('\n').length
    const byteCount = encoded.length

    let output = `Successfully wrote ${lineCount} lines (${byteCount} bytes) to ${args.path}`
    let diagnostics: Diagnostic[] = []

    // Get LSP diagnostics if available
    if (context.lspManager) {
      diagnostics = await context.lspManager.notifyFileChange(fullPath, args.content)
      output += formatDiagnosticsForLLM(diagnostics)
      output = appendLspInstallHint(output, context.lspManager, fullPath)
    }

    // Update file hash after write so subsequent writes don't require re-reading
    const newHash = await computeFileHash(fullPath)
    if (newHash) {
      context.sessionManager.updateFileHash(context.sessionId, fullPath, newHash)
    }

    // jscpd:ignore-start
    return helpers.success(output, false, {
      ...(diagnostics.length > 0 && { diagnostics }),
      metadata: { path: fullPath },
    })
    // jscpd:ignore-end
  },
)
