import { Router } from 'express'
import { readdir } from 'node:fs/promises'
import { resolve, join, dirname, basename } from 'node:path'
import { isDirectoryEntry } from '../utils/fs.js'
import { serverT } from '../i18n.js'

export function createDirectoryRoutes(): Router {
  const router = Router()

  const DEFAULT_BASE_PATH = process.cwd()

  router.get('/', async (req, res) => {
    const path = (req.query['path'] as string) || DEFAULT_BASE_PATH

    try {
      const resolvedPath = resolve(path)
      const entries = await readdir(resolvedPath, { withFileTypes: true })
      const dirs = await Promise.all(
        entries.map(async (entry) =>
          (await isDirectoryEntry(resolvedPath, entry))
            ? { name: entry.name, path: join(resolvedPath, entry.name) }
            : null,
        ),
      )
      const directories = dirs
        .filter((d): d is { name: string; path: string } => d !== null)
        .sort((a, b) => a.name.localeCompare(b.name))

      const parent = dirname(resolvedPath)
      const hasParent = parent !== resolvedPath

      res.json({
        current: resolvedPath,
        parent: hasParent ? parent : null,
        directories,
        basename: basename(resolvedPath),
      })
    } catch {
      res.status(400).json({
        error: serverT({ en: 'Cannot read directory', fr: 'Impossible de lire le répertoire' }),
        current: DEFAULT_BASE_PATH,
        parent: null,
        directories: [],
        basename: basename(DEFAULT_BASE_PATH),
      })
    }
  })

  return router
}
