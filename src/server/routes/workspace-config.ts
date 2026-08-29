import { Router } from 'express'
import { stat, mkdir, readdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, isAbsolute, join, win32 } from 'node:path'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '../git/workspace-config.js'
import { getGlobalDataDir } from '../git/workspace.js'
import { isDirectoryEntry } from '../utils/fs.js'
import { getProjectByWorkdir, updateProject } from '../db/projects.js'
import { setSessionDisabledServers, computeDisabledServersForProject } from '../mcp/session-overrides.js'
import { logger } from '../utils/logger.js'
import type { WorkspaceConfig } from '../../shared/workspace.js'
import { formatRootDir, getRootDirBlockReason, suggestRootDirChild } from '../../shared/workspace.js'
import type { SessionManager } from '../session/manager.js'
import { serverT } from '../i18n.js'

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

/**
 * Compare two resolved directory paths. On Windows separators are interchangeable
 * and the filesystem is case-insensitive, so `C:\Foo\` and `c:/foo` are the same
 * directory — comparing them raw makes an unchanged rootDir look like a move and
 * triggers a phantom orphan scan.
 */
function isSameDir(a: string, b: string): boolean {
  if (process.platform !== 'win32') return a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
  const normalize = (p: string): string => win32.normalize(p).replace(/\\+$/, '').toLowerCase()
  return normalize(a) === normalize(b)
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
  return serverT({
    en: 'Workspace root directory exists but is not writable',
    fr: 'Le répertoire racine du workspace existe mais n’est pas accessible en écriture',
  })
}

/** Error message when a rootDir choice is blocked, or null when allowed. */
function rootDirBlockError(
  blockReason: ReturnType<typeof getRootDirBlockReason> | null,
  displayPath: string,
  suggestion?: string,
): string | null {
  if (blockReason === 'exact') {
    return suggestion
      ? serverT(
          {
            en: 'Cannot use "{{path}}" directly as workspace root. Use a subdirectory like "{{suggestion}}" instead.',
            fr: 'Impossible d’utiliser « {{path}} » directement comme racine du workspace. Utilisez plutôt un sous-répertoire comme « {{suggestion}} ».',
          },
          { path: displayPath, suggestion },
        )
      : serverT(
          {
            en: 'Cannot use "{{path}}" directly as workspace root. Use a subdirectory instead.',
            fr: 'Impossible d’utiliser « {{path}} » directement comme racine du workspace. Utilisez un sous-répertoire à la place.',
          },
          { path: displayPath },
        )
  }
  if (blockReason === 'virtual_fs') {
    return serverT(
      {
        en: 'Cannot use paths under "{{path}}" for workspaces.',
        fr: 'Impossible d’utiliser des chemins sous « {{path}} » pour les workspaces.',
      },
      { path: displayPath },
    )
  }
  return null
}

async function findOrphanedWorkspaces(dir: string): Promise<{ name: string }[]> {
  const results: { name: string }[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (await isDirectoryEntry(dir, entry)) {
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

export function createWorkspaceConfigRoutes(sessionManager: SessionManager): Router {
  const router = Router()

  router.get('/config', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: serverT({ en: 'workdir required', fr: 'workdir requis' }) })
    const config = await loadWorkspaceConfig(workdir)
    const project = getProjectByWorkdir(workdir)
    const rootDir = project?.workspaceRootDir ?? undefined
    const mcpOverrides = project?.mcpOverrides ?? undefined
    if (!config && !rootDir && !mcpOverrides) return res.json({ config: null })
    res.json({ config: { ...config, rootDir, mcpOverrides } })
  })

  router.post('/config', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: serverT({ en: 'workdir required', fr: 'workdir requis' }) })
    const { setup, rootDir, mcpOverrides } = req.body
    if (!Array.isArray(setup) && typeof rootDir !== 'string' && mcpOverrides === undefined) {
      return res.status(400).json({
        error: serverT({
          en: 'At least one of setup, rootDir, or mcpOverrides must be provided',
          fr: 'Au moins un de setup, rootDir ou mcpOverrides doit être fourni',
        }),
      })
    }
    if (setup !== undefined && !Array.isArray(setup)) {
      return res.status(400).json({
        error: serverT({ en: 'setup must be an array of strings', fr: 'setup doit être un tableau de chaînes' }),
      })
    }
    if (
      mcpOverrides !== undefined &&
      (typeof mcpOverrides !== 'object' || mcpOverrides === null || Array.isArray(mcpOverrides))
    ) {
      return res.status(400).json({
        error: serverT({
          en: 'mcpOverrides must be an object mapping server names to overrides',
          fr: 'mcpOverrides doit être un objet associant les noms de serveurs à des surcharges',
        }),
      })
    }
    // Merge with existing config to preserve fields not in this request
    const existing = await loadWorkspaceConfig(workdir)
    const config: WorkspaceConfig = { ...existing }
    if (Array.isArray(setup)) {
      config.setup = setup
    }
    let savedRootDir: string | null | undefined // null=clear, string=set, undefined=skip
    if (typeof rootDir === 'string') {
      const trimmed = rootDir.trim()
      if (trimmed) {
        const resolvedPath = resolveRootDir(trimmed, workdir)
        const displayPath = formatRootDir(resolvedPath)
        const blockReason = getRootDirBlockReason(resolvedPath)
        const blockError = rootDirBlockError(blockReason, displayPath)
        if (blockError) return res.status(400).json({ error: blockError })
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

      // Save MCP overrides to project DB and propagate to sessions
      if (mcpOverrides !== undefined) {
        const project = getProjectByWorkdir(workdir)
        if (project) {
          const overridesObj =
            Object.keys(mcpOverrides).length > 0
              ? (mcpOverrides as Record<string, { disabled?: boolean; disabledTools?: string[] }>)
              : null
          updateProject(project.id, {
            mcpOverrides: overridesObj,
          })
          const disabledServers = computeDisabledServersForProject(overridesObj)
          const allSessions = sessionManager.listSessions()
          for (const s of allSessions) {
            if (s.projectId === project.id) {
              setSessionDisabledServers(s.id, disabledServers)
              sessionManager.setDynamicContextChanged(s.id, true)
            }
          }
        }
      }

      res.json({ config: { ...config, rootDir: savedRootDir ?? undefined } })
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : serverT({ en: 'Failed to save config', fr: 'Échec de l’enregistrement de la configuration' }),
      })
    }
  })

  router.post('/config/validate', async (req, res) => {
    const { rootDir, workdir, projectName, createIfMissing } = req.body
    if (!rootDir || typeof rootDir !== 'string') {
      return res.status(400).json({ error: serverT({ en: 'rootDir is required', fr: 'rootDir est requis' }) })
    }
    if (!workdir || typeof workdir !== 'string') {
      return res.status(400).json({ error: serverT({ en: 'workdir is required', fr: 'workdir est requis' }) })
    }

    const resolvedPath = resolveRootDir(rootDir, workdir)
    const displayPath = formatRootDir(resolvedPath)

    const blockReason = getRootDirBlockReason(resolvedPath)
    const suggestion = typeof projectName === 'string' ? suggestRootDirChild(resolvedPath, projectName) : undefined
    const blockError = rootDirBlockError(blockReason, displayPath, suggestion)
    if (blockError) return res.status(400).json({ error: blockError })

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

      if (previousRootDir && !isSameDir(previousRootDir, resolvedPath)) {
        const orphans = await findOrphanedWorkspaces(previousRootDir)
        workspaces.push(...orphans)
      } else if (!previousRootDir && projectName && typeof projectName === 'string') {
        const defaultDir = join(getGlobalDataDir(), 'workspaces', projectName)
        if (!isSameDir(defaultDir, resolvedPath)) {
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
