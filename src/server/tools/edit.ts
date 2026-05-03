import { readFile, writeFile } from 'node:fs/promises'
import type { Diagnostic, EditContextRegion } from '../../shared/types.js'
import { createTool } from './tool-helpers.js'
import { formatDiagnosticsForLLM } from './diagnostics.js'
import { validateFileForWrite, computeFileHash } from './file-tracker.js'
import { extractEditContext } from './edit-context.js'

function detectLineEnding(content: string): 'crlf' | 'lf' | 'cr' {
  if (content.includes('\r\n')) return 'crlf'
  if (content.includes('\n')) return 'lf'
  if (content.includes('\r')) return 'cr'
  return 'lf'
}

function normalizeToLF(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

interface EditFileArgs {
  path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

export const editFileTool = createTool<EditFileArgs>(
  'edit_file',
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Replace specific text in a file. Use this for surgical edits. The old_string must match exactly (including whitespace and indentation).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (relative to workdir or absolute)',
          },
          old_string: {
            type: 'string',
            description: 'Exact text to find and replace. Must match exactly including whitespace.',
          },
          new_string: {
            type: 'string',
            description: 'Replacement text',
          },
          replace_all: {
            type: 'boolean',
            description:
              'Replace all occurrences (default: false). If false and multiple matches found, the operation fails.',
          },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  async (args, context, helpers) => {
    const replaceAll = args.replace_all ?? false

    const fullPath = helpers.resolvePath(args.path)
    await helpers.checkPathAccess([fullPath])

    const readFiles = context.sessionManager.getReadFiles(context.sessionId)
    const validation = await validateFileForWrite(fullPath, readFiles)
    if (!validation.valid) {
      return helpers.error(validation.error?.message ?? 'File validation failed')
    }

    let content: string
    try {
      content = await readFile(fullPath, 'utf-8')
    } catch {
      return helpers.error(`File not found: ${args.path}`)
    }

    const fileLineEnding = detectLineEnding(content)
    const normalizedContent = normalizeToLF(content)
    const normalizedOldString = normalizeToLF(args.old_string)

    const occurrences = normalizedContent.split(normalizedOldString).length - 1

    if (occurrences === 0) {
      const preview = args.old_string.length > 100 ? args.old_string.slice(0, 100) + '...' : args.old_string

      return helpers.error(
        `old_string not found in file.\n\nSearched for:\n${preview}\n\nMake sure whitespace and indentation match exactly.`,
      )
    }

    if (occurrences > 1 && !replaceAll) {
      return helpers.error(
        `Found ${occurrences} matches for old_string. Use replace_all: true to replace all, or provide more context to make the match unique.`,
      )
    }

    const contextResult = extractEditContext(
      normalizedContent,
      normalizedOldString,
      normalizeToLF(args.new_string),
      replaceAll,
    )

    const editContextRegions: EditContextRegion[] = contextResult.regions.map((region) => ({
      beforeContext: region.beforeContext.map((line) => ({
        lineNumber: line.lineNumber,
        content: line.content,
      })),
      afterContext: region.afterContext.map((line) => ({
        lineNumber: line.lineNumber,
        content: line.content,
      })),
      startLine: region.startLine,
      endLine: region.endLine,
      oldContent: region.oldContent,
      newContent: region.newContent,
      edits: region.edits.map((edit) => ({
        startLine: edit.startLine,
        endLine: edit.endLine,
        oldContent: edit.oldContent,
        newContent: edit.newContent,
      })),
    }))

    const normalizedNewString = normalizeToLF(args.new_string)

    // FIX: String.replace() treats $ as special replacement patterns ($&, $', $`, $$, $n)
    // Our new_string contains '$' in code like "$' + value.toFixed(2)" which gets mangled
    // Solution: Use index-based replacement to avoid regex/replace pattern interpretation
    let replacedContent: string
    if (replaceAll) {
      replacedContent = normalizedContent.replaceAll(normalizedOldString, normalizedNewString)
    } else {
      const index = normalizedContent.indexOf(normalizedOldString)
      if (index === -1) {
        return helpers.error('old_string not found in file (unexpected)')
      }
      replacedContent =
        normalizedContent.slice(0, index) +
        normalizedNewString +
        normalizedContent.slice(index + normalizedOldString.length)
    }

    const newContent = replacedContent.replace(
      /\n/g,
      fileLineEnding === 'crlf' ? '\r\n' : fileLineEnding === 'cr' ? '\r' : '\n',
    )

    await writeFile(fullPath, newContent, 'utf-8')

    let output = `Successfully replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${args.path}`
    let diagnostics: Diagnostic[] = []

    if (context.lspManager) {
      diagnostics = await context.lspManager.notifyFileChange(fullPath, newContent)
      output += formatDiagnosticsForLLM(diagnostics)
    }

    const newHash = await computeFileHash(fullPath)
    if (newHash) {
      context.sessionManager.updateFileHash(context.sessionId, fullPath, newHash)
    }

    return helpers.success(output, false, {
      ...(diagnostics.length > 0 && { diagnostics }),
      ...(editContextRegions.length > 0 && { editContext: { regions: editContextRegions } }),
    })
  },
)
