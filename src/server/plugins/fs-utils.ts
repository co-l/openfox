import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Dirent } from 'node:fs'

export interface PackageDirectoryOptions {
  skipTopLevel?: (name: string) => boolean
  skipChild?: (name: string) => boolean
}

export async function isDirectoryEntry(entry: Dirent, path: string): Promise<boolean> {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false
}

export async function packageDirectories(root: string, options?: PackageDirectoryOptions): Promise<string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const directories: string[] = []
  for (const entry of entries) {
    if (options?.skipTopLevel?.(entry.name)) continue
    const entryPath = join(root, entry.name)
    if (!(await isDirectoryEntry(entry, entryPath))) continue
    if (entry.name.startsWith('@')) {
      const scoped = await readdir(entryPath, { withFileTypes: true }).catch(() => [])
      for (const child of scoped) {
        if (options?.skipChild?.(child.name)) continue
        const childPath = join(entryPath, child.name)
        if (await isDirectoryEntry(child, childPath)) directories.push(childPath)
      }
    } else {
      directories.push(entryPath)
    }
  }
  return directories
}
