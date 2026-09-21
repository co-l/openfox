import { resolve } from 'node:path'
import type { FileReadEntry } from '../../shared/types.js'
import { validateFileForWrite } from '../tools/file-tracker.js'

export interface PreflightContext {
  workdir: string
  readFiles: Record<string, FileReadEntry>
}

/**
 * Fast-fail preflight for path-based tools (write_file, edit_file).
 *
 * Runs the exact same read-before-write validation the tools themselves
 * perform, but against a bare path — before the LLM has streamed the doomed
 * payload (file content, old/new strings). Returns an error message when the
 * target exists but wasn't read (or changed externally since read), so the
 * streaming layer can abort early; returns undefined to let the call proceed.
 */
export async function preflightPathTool(path: string, context: PreflightContext): Promise<string | undefined> {
  const fullPath = resolve(context.workdir, path)
  const validation = await validateFileForWrite(fullPath, context.readFiles, context.workdir)
  if (validation.valid) return undefined
  return validation.error?.message ?? 'File validation failed'
}
