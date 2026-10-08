import { Router } from 'express'
import { readdir } from 'node:fs/promises'
import { resolve, join, dirname, basename } from 'node:path'
import { isDirectoryEntry } from '../utils/fs.js'
import { driveRootParent, listDrives } from '../utils/drives.js'
import { DRIVES_VIEW } from '../../shared/directory.js'
import { serverT } from '../i18n.js'

export function createDirectoryRoutes(): Router {
  const router = Router()

  const DEFAULT_BASE_PATH = process.cwd()

  const errorResponse = (path: string) => ({
    error: serverT({ en: 'Cannot read directory', fr: 'Impossible de lire le répertoire' }),
    current: path,
    parent: null,
    directories: [],
    basename: basename(path),
  })

  router.get('/drives', async (_req, res) => {
    const drives = await listDrives(process.platform)
    res.json({
      current: DRIVES_VIEW,
      parent: null,
      directories: drives,
      basename: DRIVES_VIEW,
      drives,
    })
  })

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

      const drives = process.platform === 'win32' ? await listDrives(process.platform) : undefined

      const parent = driveRootParent(resolvedPath, process.platform) ?? dirname(resolvedPath)
      const hasParent = parent !== resolvedPath

      res.json({
        current: resolvedPath,
        parent: hasParent ? parent : null,
        directories,
        basename: basename(resolvedPath),
        ...(drives ? { drives } : {}),
      })
    } catch {
      res.status(400).json(errorResponse(DEFAULT_BASE_PATH))
    }
  })

  return router
}
