/**
 * Live edit context for streaming edit_file calls.
 *
 * While the LLM is still generating an edit_file call, its tool.preparing
 * events carry partial JSON arguments. This helper reads the target file once
 * and computes the same edit context (surrounding lines) that the final tool
 * result carries, so the UI can render the context live while streaming.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { EditContextRegion } from '../../shared/types.js'
import { parsePartialFileArgs } from '../../shared/partial-tool-args.js'
import { extractEditContext } from '../../shared/edit-context.js'

/**
 * Compute the edit context for a partial edit_file arguments fragment.
 *
 * The file content is read at most once per resolved path (cache). Returns
 * undefined when the fragment is incomplete, the file is unreadable, or the
 * edit does not match the file yet — the caller then falls back to the plain
 * old/new diff.
 */
export async function computeLiveEditContext(
  argsFragment: string | undefined,
  workdir: string,
  cache: Map<string, string>,
): Promise<EditContextRegion[] | undefined> {
  if (!argsFragment) return undefined
  const parsed = parsePartialFileArgs(argsFragment)
  if (!parsed.path || (!parsed.old_string && !parsed.new_string)) return undefined

  const fullPath = resolve(workdir, parsed.path)
  let content = cache.get(fullPath)
  if (content === undefined) {
    try {
      content = await readFile(fullPath, 'utf8')
    } catch {
      cache.set(fullPath, '')
      return undefined
    }
    cache.set(fullPath, content)
  }
  if (!content) return undefined

  const { regions } = extractEditContext(
    content,
    parsed.old_string ?? '',
    parsed.new_string ?? '',
    parsed.replace_all ?? false,
  )
  return regions.length > 0 ? regions : undefined
}
