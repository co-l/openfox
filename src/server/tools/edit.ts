import { readFile, writeFile } from 'node:fs/promises'
import { relative } from 'node:path'
import type { Diagnostic, EditContextRegion } from '../../shared/types.js'
import { createTool } from './tool-helpers.js'
import { formatDiagnosticsForLLM, appendLspInstallHint } from './diagnostics.js'
import { validateFileForWrite, computeFileHash } from './file-tracker.js'
import { extractEditContext } from '../../shared/edit-context.js'
import { detectEncoding, decodeContent, encodeContent } from '../utils/encoding.js'

// Per-file mutex to serialize parallel edits on the same file.
// Prevents the read-modify-write race condition where concurrent edits
// all read the same original content and only the last write survives.
const fileLocks = new Map<string, FileLockState>()

interface FileLockState {
  tail: Promise<void>
  pending: number
}

interface FileLockHandle {
  /** True when no other edit is queued or running on this file. */
  isLastInQueue: () => boolean
}

async function withFileLock<T>(filePath: string, fn: (handle: FileLockHandle) => Promise<T>): Promise<T> {
  let state = fileLocks.get(filePath)
  if (!state) {
    state = { tail: Promise.resolve(), pending: 0 }
    fileLocks.set(filePath, state)
  }
  state.pending += 1

  const handle: FileLockHandle = {
    isLastInQueue: () => state!.pending === 1,
  }

  const prev = state.tail
  const run = prev.then(() => fn(handle))
  state.tail = run.then(
    () => {},
    () => {},
  )

  // Decrement the queue count when the locked fn settles. Using then(ok, err)
  // (not .finally) so a rejecting fn (e.g. a rethrown PathAccessDeniedError)
  // cannot produce an unhandled rejection on the cleanup promise.
  const settle = (): void => {
    state!.pending -= 1
    if (state!.pending <= 0 && fileLocks.get(filePath) === state) {
      fileLocks.delete(filePath)
    }
  }
  run.then(settle, settle)

  return run
}

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
    const fullPath = helpers.resolvePath(args.path)
    await helpers.checkPathAccess([fullPath])

    return withFileLock(fullPath, async (handle) => {
      const replaceAll = args.replace_all ?? false

      // jscpd:ignore-start
      const readFiles = context.sessionManager.getReadFiles(context.sessionId)
      const validation = await validateFileForWrite(fullPath, readFiles, context.workdir)
      if (!validation.valid) {
        return helpers.error(validation.error?.message ?? 'File validation failed')
      }
      // jscpd:ignore-end

      let rawBuffer: Buffer
      try {
        rawBuffer = await readFile(fullPath)
      } catch {
        return helpers.error(`File not found: ${args.path}`)
      }

      const { encoding, bomSize } = detectEncoding(rawBuffer)
      const content = decodeContent(rawBuffer, encoding)
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

      const restoredContent = replacedContent.replace(
        /\n/g,
        fileLineEnding === 'crlf' ? '\r\n' : fileLineEnding === 'cr' ? '\r' : '\n',
      )

      const encoded = encodeContent(restoredContent, encoding, bomSize > 0)
      await writeFile(fullPath, encoded)

      let output = `Successfully replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${args.path}`
      let diagnostics: Diagnostic[] = []

      if (context.lspManager) {
        // Only the last edit of a same-file batch waits for diagnostics: it
        // reflects the final state after all writes. Intermediate edits push
        // the change to the LSP but return immediately, so a burst of N
        // parallel edits costs ~1 language-server round-trip instead of N.
        const isLast = handle.isLastInQueue()
        diagnostics = await context.lspManager.notifyFileChange(fullPath, restoredContent, isLast)
        if (isLast) {
          output += formatDiagnosticsForLLM(diagnostics)
        }
        // Install hints are one-shot per session; report them on every edit so
        // an intermediate edit of a batch is not the one that loses it.
        output = appendLspInstallHint(output, context.lspManager, fullPath)
      }

      const newHash = await computeFileHash(fullPath)
      if (newHash) {
        context.sessionManager.updateFileHash(context.sessionId, fullPath, newHash, relative(context.workdir, fullPath))
      }

      return helpers.success(output, false, {
        ...(diagnostics.length > 0 && { diagnostics }),
        ...(editContextRegions.length > 0 && { editContext: { regions: editContextRegions } }),
        metadata: { path: fullPath },
      })
    })
  },
)
