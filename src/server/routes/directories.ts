import { Router } from 'express'
import { readdir } from 'node:fs/promises'
import { resolve, join, dirname, basename } from 'node:path'

export function createDirectoryRoutes(): Router {
  const router = Router()

  const DEFAULT_BASE_PATH = process.cwd()

  router.get('/', async (req, res) => {
    const path = (req.query['path'] as string) || DEFAULT_BASE_PATH

    try {
      const resolvedPath = resolve(path)
      const entries = await readdir(resolvedPath, { withFileTypes: true })
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          path: join(resolvedPath, entry.name),
        }))
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
        error: 'Cannot read directory',
        current: DEFAULT_BASE_PATH,
        parent: null,
        directories: [],
        basename: basename(DEFAULT_BASE_PATH),
      })
    }
  })

  return router
}
