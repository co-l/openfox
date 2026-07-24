import { Router } from 'express'
import { stat, mkdir, readdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, isAbsolute, join } from 'node:path'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '../git/workspace-config.js'
import { getGlobalDataDir } from '../git/workspace.js'
import { getProjectByWorkdir, updateProject } from '../db/projects.js'
import { logger } from '../utils/logger.js'
import type { WorkspaceConfig } from '../../shared/workspace.js'
import { getRootDirBlockReason } from '../../shared/workspace.js'

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function resolveRootDir(rootDir: string, workdir: string): string {
  return isAbsolute(rootDir) ? rootDir : resolve(workdir, rootDir)
}

async function checkDirExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path)
    return st.isDirectory()
  } catch {
    return false
  }
}

async function validatePathWritable(path: string): Promise<string | null> {
  if (await isWritable(path)) return null
  return 'Workspace root directory exists but is not writable'
}

async function findOrphanedWorkspaces(dir: string): Promise<{ name: string }[]> {
  const results: { name: string }[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          const gitStat = await stat(join(dir, entry.name, '.git'))
          if (gitStat.isDirectory()) {
            results.push({ name: entry.name })
          }
        } catch {
          // Not a valid git workspace
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.error('Error scanning for orphaned workspaces', { dir, error: String(err) })
    }
  }
  return results
}

export function createWorkspaceConfigRoutes(): Router {
  const router = Router()

  router.get('/config', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: 'workdir required' })
    const config = await loadWorkspaceConfig(workdir)
    const project = getProjectByWorkdir(workdir)
    const rootDir = project?.workspaceRootDir ?? undefined
    if (!config && !rootDir) return res.json({ config: null })
    res.json({ config: { ...config, rootDir } })
  })

  router.post('/config', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: 'workdir required' })
    const { setup, rootDir, mcpOverrides } = req.body
    if (!Array.isArray(setup) && typeof rootDir !== 'string' && mcpOverrides === undefined) {
      return res.status(400).json({ error: 'At least one of setup, rootDir, or mcpOverrides must be provided' })
    }
    if (setup !== undefined && !Array.isArray(setup)) {
      return res.status(400).json({ error: 'setup must be an array of strings' })
    }
    if (
      mcpOverrides !== undefined &&
      (typeof mcpOverrides !== 'object' || mcpOverrides === null || Array.isArray(mcpOverrides))
    ) {
      return res.status(400).json({ error: 'mcpOverrides must be an object mapping server names to overrides' })
    }
    // Merge with existing config to preserve fields not in this request
    const existing = await loadWorkspaceConfig(workdir)
    const config: WorkspaceConfig = { ...existing }
    if (Array.isArray(setup)) {
      config.setup = setup
    }
    if (mcpOverrides !== undefined) {
      if (Object.keys(mcpOverrides).length > 0) {
        config.mcpOverrides = mcpOverrides
      } else {
        delete config.mcpOverrides
      }
    }
    let savedRootDir: string | null | undefined // null=clear, string=set, undefined=skip
    if (typeof rootDir === 'string') {
      const trimmed = rootDir.trim()
      if (trimmed) {
        const resolvedPath = resolveRootDir(trimmed, workdir)
        const displayPath = resolvedPath.replace(/\/+$/, '') || '/'
        const blockReason = getRootDirBlockReason(resolvedPath)
        if (blockReason === 'exact') {
          return res
            .status(400)
            .json({ error: `Cannot use "${displayPath}" directly as workspace root. Use a subdirectory instead.` })
        }
        if (blockReason === 'virtual_fs') {
          return res.status(400).json({ error: `Cannot use paths under "${displayPath}" for workspaces.` })
        }
        const dirExists = await checkDirExists(resolvedPath)
        if (dirExists) {
          const writableErr = await validatePathWritable(resolvedPath)
          if (writableErr) return res.status(400).json({ error: writableErr })
        }
        savedRootDir = trimmed
      } else {
        // Empty string — explicitly clear rootDir
        savedRootDir = null
      }
    }
    try {
      await saveWorkspaceConfig(workdir, config)
      if (savedRootDir !== undefined) {
        const project = getProjectByWorkdir(workdir)
        if (project) {
          updateProject(project.id, { workspaceRootDir: savedRootDir })
        }
      }
      res.json({ config: { ...config, rootDir: savedRootDir ?? undefined } })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save config' })
    }
  })

  router.post('/config/validate', async (req, res) => {
    const { rootDir, workdir, projectName, createIfMissing } = req.body
    if (!rootDir || typeof rootDir !== 'string') {
      return res.status(400).json({ error: 'rootDir is required' })
    }
    if (!workdir || typeof workdir !== 'string') {
      return res.status(400).json({ error: 'workdir is required' })
    }

    const resolvedPath = resolveRootDir(rootDir, workdir)
    const displayPath = resolvedPath.replace(/\/+$/, '') || '/'

    const blockReason = getRootDirBlockReason(resolvedPath)
    if (blockReason === 'exact') {
      const suggestion = typeof projectName === 'string' ? `${displayPath}/${projectName}` : undefined
      return res.status(400).json({
        error: suggestion
          ? `Cannot use "${displayPath}" directly as workspace root. Use a subdirectory like "${suggestion}" instead.`
          : `Cannot use "${displayPath}" directly as workspace root. Use a subdirectory instead.`,
      })
    }
    if (blockReason === 'virtual_fs') {
      return res.status(400).json({ error: `Cannot use paths under "${displayPath}" for workspaces.` })
    }

    let dirExists = await checkDirExists(resolvedPath)
    if (dirExists) {
      const writableErr = await validatePathWritable(resolvedPath)
      if (writableErr) return res.status(400).json({ error: writableErr })
    }

    let created = false
    if (!dirExists && createIfMissing) {
      await mkdir(resolvedPath, { recursive: true })
      dirExists = true
      created = true
    }

    const workspaces: { name: string }[] = []
    try {
      const project = getProjectByWorkdir(workdir)
      const previousRootDir = project?.workspaceRootDir ? resolveRootDir(project.workspaceRootDir, workdir) : null

      if (previousRootDir && previousRootDir !== resolvedPath) {
        const orphans = await findOrphanedWorkspaces(previousRootDir)
        workspaces.push(...orphans)
      } else if (!previousRootDir && projectName && typeof projectName === 'string') {
        const defaultDir = join(getGlobalDataDir(), 'workspaces', projectName)
        if (defaultDir !== resolvedPath) {
          const orphans = await findOrphanedWorkspaces(defaultDir)
          workspaces.push(...orphans)
        }
      }
    } catch {
      // No previous config
    }

    res.json({ exists: dirExists, resolvedPath, created, workspaces })
  })

  return router
}
