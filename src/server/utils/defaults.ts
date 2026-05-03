import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function findModifiedDefaultFiles(
  defaultIds: string[],
  extension: string,
  bundledDirs: readonly [string, string],
  userDir: string,
): Promise<string[]> {
  const [primaryDir, altDir] = bundledDirs
  const modified: string[] = []

  for (const id of defaultIds) {
    const filename = `${id}${extension}`
    const userPath = join(userDir, filename)

    let bundledContent: string | null = null
    for (const dir of [primaryDir, altDir]) {
      try {
        bundledContent = await readFile(join(dir, filename), 'utf-8')
        break
      } catch {
        /* try next */
      }
    }
    if (!bundledContent) continue

    try {
      const userContent = await readFile(userPath, 'utf-8')
      if (userContent !== bundledContent) {
        modified.push(id)
      }
    } catch {
      // User file doesn't exist — treat as not modified (will be re-created)
    }
  }

  return modified
}
