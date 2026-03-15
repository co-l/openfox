import { readFile, writeFile } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import type { ToolResult, Diagnostic } from '@openfox/shared'
import type { Tool, ToolContext } from './types.js'
import { formatDiagnosticsForLLM } from './diagnostics.js'
import { requestPathAccess } from './path-security.js'

export const editFileTool: Tool = {
  name: 'edit_file',
  definition: {
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
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const path = args['path'] as string
      const oldString = args['old_string'] as string
      const newString = args['new_string'] as string
      const replaceAll = (args['replace_all'] as boolean | undefined) ?? false
      
      // Resolve path
      const fullPath = isAbsolute(path) ? path : resolve(context.workdir, path)
      
      // Check sandbox - request confirmation for paths outside workdir
      if (context.onEvent) {
        await requestPathAccess(
          [fullPath],
          context.workdir,
          context.sessionId,
          crypto.randomUUID(),
          'edit_file',
          context.onEvent
        )
      }
      
      // Read file
      let content: string
      try {
        content = await readFile(fullPath, 'utf-8')
      } catch {
        return {
          success: false,
          error: `File not found: ${path}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      // Count occurrences
      const occurrences = content.split(oldString).length - 1
      
      if (occurrences === 0) {
        // Try to provide helpful context
        const preview = oldString.length > 100 
          ? oldString.slice(0, 100) + '...' 
          : oldString
        
        return {
          success: false,
          error: `old_string not found in file.\n\nSearched for:\n${preview}\n\nMake sure whitespace and indentation match exactly.`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      if (occurrences > 1 && !replaceAll) {
        return {
          success: false,
          error: `Found ${occurrences} matches for old_string. Use replace_all: true to replace all, or provide more context to make the match unique.`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      // Perform replacement
      const newContent = replaceAll 
        ? content.replaceAll(oldString, newString)
        : content.replace(oldString, newString)
      
      // Write file
      await writeFile(fullPath, newContent, 'utf-8')
      
      let output = `Successfully replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${path}`
      let diagnostics: Diagnostic[] = []
      
      // Get LSP diagnostics if available
      if (context.lspManager) {
        diagnostics = await context.lspManager.notifyFileChange(fullPath, newContent)
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
        error: error instanceof Error ? error.message : 'Unknown error editing file',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }
  },
}
