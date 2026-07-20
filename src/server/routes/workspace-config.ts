import { Router } from 'express'
import { stat, mkdir, readdir } from 'node:fs/promises'
import { resolve, isAbsolute, join } from 'node:path'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '../git/workspace-config.js'
import type { WorkspaceConfig } from '../../shared/workspace.js'

const DANGEROUS_PATHS = [
  '/',
  '/etc',
  '/dev',
  '/proc',
  '/sys',
  '/boot',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/usr',
  '/var',
  '/opt',
  '/root',
  '/run',
  '/tmp',
  '/home',
  '/mnt',
  '/media',
  '/lost+found',
]

export function createWorkspaceConfigRoutes(): Router {
  const router = Router()

  router.get('/config', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: 'workdir required' })
    const config = await loadWorkspaceConfig(workdir)
    res.json({ config })
  })

  router.post('/config', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: 'workdir required' })
    const { setup, rootDir } = req.body
    if (!Array.isArray(setup) && typeof rootDir !== 'string') {
      return res.status(400).json({ error: 'At least one of setup or rootDir must be provided' })
    }
    if (setup !== undefined && !Array.isArray(setup)) {
      return res.status(400).json({ error: 'setup must be an array of strings' })
    }
    const config: WorkspaceConfig = {}
    if (Array.isArray(setup)) {
      config.setup = setup
    }
    if (typeof rootDir === 'string') {
      config.rootDir = rootDir
    }
    try {
      await saveWorkspaceConfig(workdir, config)
      res.json({ config })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save config' })
    }
  })

  router.post('/config/validate', async (req, res) => {
    const { rootDir, workdir, createIfMissing } = req.body
    if (!rootDir || typeof rootDir !== 'string') {
      return res.status(400).json({ error: 'rootDir is required' })
    }
    if (!workdir || typeof workdir !== 'string') {
      return res.status(400).json({ error: 'workdir is required' })
    }

    const resolvedPath = isAbsolute(rootDir) ? rootDir : resolve(workdir, rootDir)

    const normalized = resolvedPath.replace(/\/+$/, '') || '/'
    if (DANGEROUS_PATHS.includes(normalized)) {
      return res.status(400).json({ error: 'Invalid workspace root directory: cannot use system-critical paths' })
    }

    let exists = false
    try {
      const st = await stat(resolvedPath)
      exists = st.isDirectory()
    } catch {
      // Directory does not exist
    }

    let created = false
    if (!exists && createIfMissing) {
      await mkdir(resolvedPath, { recursive: true })
      exists = true
      created = true
    }

    const workspaces: { name: string }[] = []
    try {
      const currentConfig = await loadWorkspaceConfig(workdir)
      if (currentConfig?.rootDir) {
        const oldRootDir = isAbsolute(currentConfig.rootDir)
          ? currentConfig.rootDir
          : resolve(workdir, currentConfig.rootDir)

        if (oldRootDir !== resolvedPath) {
          try {
            const entries = await readdir(oldRootDir, { withFileTypes: true })
            for (const entry of entries) {
              if (entry.isDirectory()) {
                try {
                  const gitStat = await stat(join(oldRootDir, entry.name, '.git'))
                  if (gitStat.isDirectory()) {
                    workspaces.push({ name: entry.name })
                  }
                } catch {
                  // Not a valid git workspace
                }
              }
            }
          } catch {
            // Old rootDir doesn't exist or is not readable
          }
        }
      }
    } catch {
      // No previous config
    }

    res.json({ exists, resolvedPath, created, workspaces })
  })

  return router
}
