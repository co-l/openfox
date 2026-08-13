import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Dirent } from 'node:fs'

/**
 * Whether a readdir entry is a directory, following symlinks. Dirent.isDirectory()
 * reflects the entry's own file type and never follows symlinks, so symlinked
 * directories are otherwise invisible in listings. Broken and cyclic symlinks
 * (stat throws ENOENT/ELOOP) are excluded.
 */
export async function isDirectoryEntry(parent: string, entry: Dirent): Promise<boolean> {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try {
    return (await stat(join(parent, entry.name))).isDirectory()
  } catch {
    return false
  }
}
