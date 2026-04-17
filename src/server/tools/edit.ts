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
      description: 'Replace specific text in a file. Use this for surgical edits. The old_string must match exactly (including whitespace and indentation).',
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
            description: 'Replace all occurrences (default: false). If false and multiple matches found, the operation fails.',
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
    
    // Validate file was read before editing
    const readFiles = context.sessionManager.getReadFiles(context.sessionId)
    const validation = await validateFileForWrite(fullPath, readFiles)
    if (!validation.valid) {
      return helpers.error(validation.error?.message ?? 'File validation failed')
    }
    
    // Read file
    let content: string
    try {
      content = await readFile(fullPath, 'utf-8')
    } catch {
      return helpers.error(`File not found: ${args.path}`)
    }

    // Detect and normalize line endings for matching
    const fileLineEnding = detectLineEnding(content)
    const normalizedContent = normalizeToLF(content)
    const normalizedOldString = normalizeToLF(args.old_string)

    // Count occurrences on normalized content
    const occurrences = normalizedContent.split(normalizedOldString).length - 1
    
    if (occurrences === 0) {
      const preview = args.old_string.length > 100 
        ? args.old_string.slice(0, 100) + '...' 
        : args.old_string
      
      return helpers.error(
        `old_string not found in file.\n\nSearched for:\n${preview}\n\nMake sure whitespace and indentation match exactly.`
      )
    }
    
    if (occurrences > 1 && !replaceAll) {
      return helpers.error(
        `Found ${occurrences} matches for old_string. Use replace_all: true to replace all, or provide more context to make the match unique.`
      )
    }
    
    // Extract edit context on normalized content (for consistent matching)
    const contextResult = extractEditContext(normalizedContent, normalizedOldString, normalizeToLF(args.new_string), replaceAll)
    
    // Convert to shared types
    const editContextRegions: EditContextRegion[] = contextResult.regions.map(region => ({
      beforeContext: region.beforeContext.map(line => ({
        lineNumber: line.lineNumber,
        content: line.content,
      })),
      afterContext: region.afterContext.map(line => ({
        lineNumber: line.lineNumber,
        content: line.content,
      })),
      startLine: region.startLine,
      endLine: region.endLine,
      oldContent: region.oldContent,
      newContent: region.newContent,
      edits: region.edits.map(edit => ({
        startLine: edit.startLine,
        endLine: edit.endLine,
        oldContent: edit.oldContent,
        newContent: edit.newContent,
      })),
    }))
    
    // Perform replacement on normalized content (all LF)
    const replacedContent = replaceAll
      ? normalizedContent.replaceAll(normalizedOldString, args.new_string)
      : normalizedContent.replace(normalizedOldString, args.new_string)

    // Restore file's original line endings to entire file
    const newContent = replacedContent.replace(/\n/g, fileLineEnding === 'crlf' ? '\r\n' : fileLineEnding === 'cr' ? '\r' : '\n')

    // Write file
    await writeFile(fullPath, newContent, 'utf-8')
    
    let output = `Successfully replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${args.path}`
    let diagnostics: Diagnostic[] = []
    
    // Get LSP diagnostics if available
    if (context.lspManager) {
      diagnostics = await context.lspManager.notifyFileChange(fullPath, newContent)
      output += formatDiagnosticsForLLM(diagnostics)
    }
    
    // Update file hash after edit so subsequent edits don't require re-reading
    const newHash = await computeFileHash(fullPath)
    if (newHash) {
      context.sessionManager.updateFileHash(context.sessionId, fullPath, newHash)
    }
    
    return helpers.success(output, false, {
      ...(diagnostics.length > 0 && { diagnostics }),
      ...(editContextRegions.length > 0 && { editContext: { regions: editContextRegions } }),
    })
  }
)
