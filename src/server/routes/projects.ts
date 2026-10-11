import { Router } from 'express'
import type { Request, Response } from 'express'
import type { Config } from '../config.js'
import type { SessionManager } from '../session/manager.js'

export interface ProjectsRouteDeps {
  config: Config
  sessionManager: SessionManager
}

function getParam(req: Request, name: string): string | undefined {
  const value = req.params[name]
  return typeof value === 'string' ? value : undefined
}

function requireParam(req: Request, res: Response, name: string): string | null {
  const value = getParam(req, name)
  if (!value) {
    res.status(400).json({ error: `${name} is required` })
    return null
  }
  return value
}

async function getProjectOr404(res: Response, id: string) {
  const { getProject } = await import('../db/projects.js')
  const project = getProject(id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return null
  }
  return project
}

async function requireGitRepo(res: Response, workdir: string): Promise<boolean> {
  const { isGitRepository } = await import('../git/workspace.js')
  if (!(await isGitRepository(workdir))) {
    res.status(400).json({ error: 'Project is not a git repository' })
    return false
  }
  return true
}

async function syncBranchToProjectSessions(
  sessionManager: SessionManager,
  projectWorkdir: string,
  branchName: string,
): Promise<void> {
  const { updateSessionBranch } = await import('../db/sessions.js')
  const allSessions = sessionManager.listSessions()
  for (const s of allSessions) {
    if (sessionManager.getEffectiveWorkdir(s.id) === projectWorkdir) {
      updateSessionBranch(s.id, branchName)
      sessionManager.emitBranchChange(s.id)
    }
  }
}

export function createProjectsRouter(deps: ProjectsRouteDeps): Router {
  const { config, sessionManager } = deps
  const router = Router()

  router.get('/projects', async (_req: Request, res: Response) => {
    const { listProjects } = await import('../db/projects.js')
    const projects = listProjects()
    res.json({ projects })
  })

  router.post('/projects', async (req: Request, res: Response) => {
    const { name, workdir } = req.body
    if (!name || !workdir) {
      return res.status(400).json({ error: 'name and workdir are required' })
    }
    const { createProjectDirectory } = await import('../utils/project-creator.js')
    const { loadGlobalConfig } = await import('../../cli/config.js')
    const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
    try {
      const project = await createProjectDirectory(name, workdir, globalConfig.workspace?.autoGitInit ?? true)
      res.status(201).json({ project })
    } catch (err) {
      const eaccError = err as Error & { code?: string; cause?: unknown }
      return res.status(403).json({
        error: eaccError.message || 'Unknown error',
        code: eaccError.code || 'UNKNOWN',
        path: workdir,
      })
    }
  })

  router.post('/projects/check-permissions', async (req: Request, res: Response) => {
    const { path: targetPath } = req.body
    if (!targetPath) {
      return res.status(400).json({ error: 'path is required' })
    }

    const { checkPermissions } = await import('../utils/permissions.js')
    const result = await checkPermissions(targetPath)

    if (result.success) {
      res.json(result)
    } else {
      const status = (result as { status?: number }).status ?? 500
      res.status(status).json({ error: result.error })
    }
  })

  router.post('/projects/fix-permissions', async (req: Request, res: Response) => {
    const { path: targetPath, action } = req.body
    if (!targetPath) {
      return res.status(400).json({ error: 'path is required' })
    }
    if (!['group', 'ownership', 'join_group', 'join_group_and_group'].includes(action)) {
      return res
        .status(400)
        .json({ error: 'action must be "group", "ownership", "join_group", or "join_group_and_group"' })
    }

    const { fixPermissions } = await import('../utils/permissions.js')
    const result = await fixPermissions(targetPath, action)

    if (result.success) {
      res.json(result)
    } else {
      const status = (result as { status?: number }).status ?? 500
      res.status(status).json(result)
    }
  })

  router.get('/projects/:id', async (req: Request, res: Response) => {
    const id = requireParam(req, res, 'id')
    if (!id) return
    const project = await getProjectOr404(res, id)
    if (!project) return
    res.json({ project })
  })

  router.get('/projects/:id/open-folder', async (req: Request, res: Response) => {
    const id = requireParam(req, res, 'id')
    if (!id) return
    const project = await getProjectOr404(res, id)
    if (!project) return
    try {
      const { openFolder } = await import('../utils/openFolder.js')
      await openFolder(project.workdir)
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to open folder' })
    }
  })

  router.put('/projects/:id', async (req: Request, res: Response) => {
    const id = requireParam(req, res, 'id')
    if (!id) return
    const { updateProject } = await import('../db/projects.js')
    const { name, customInstructions, dangerLevel, defaultAgent } = req.body
    const updates: {
      name?: string
      customInstructions?: string | null
      dangerLevel?: string | null
      defaultAgent?: string | null
    } = {}
    if (name !== undefined) updates.name = name
    if (customInstructions !== undefined) updates.customInstructions = customInstructions
    if (dangerLevel !== undefined) updates.dangerLevel = dangerLevel as string | null
    if (defaultAgent !== undefined) updates.defaultAgent = defaultAgent as string | null
    const updated = updateProject(id, updates)
    if (!updated) {
      return res.status(404).json({ error: 'Project not found' })
    }
    res.json({ project: updated })
  })

  router.delete('/projects/:id', async (req: Request, res: Response) => {
    const id = requireParam(req, res, 'id')
    if (!id) return
    const project = await getProjectOr404(res, id)
    if (!project) return
    const { deleteProject } = await import('../db/projects.js')
    deleteProject(id)
    res.json({ success: true })
  })

  router.put('/projects/:id/star', async (req: Request, res: Response) => {
    const id = requireParam(req, res, 'id')
    if (!id) return
    const { toggleStar } = await import('../db/projects.js')
    const { isStarred } = req.body
    if (typeof isStarred !== 'boolean') {
      return res.status(400).json({ error: 'isStarred is required and must be a boolean' })
    }
    const project = toggleStar(id, isStarred)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }
    res.json({ project })
  })

  router.get('/projects/:id/branches', async (req: Request, res: Response) => {
    const id = requireParam(req, res, 'id')
    if (!id) return
    const project = await getProjectOr404(res, id)
    if (!project) return
    const { listBranches } = await import('../git/workspace.js')
    const branches = await listBranches(project.workdir)
    res.json({ branches })
  })

  router.post('/projects/:id/checkout', async (req: Request, res: Response) => {
    const id = requireParam(req, res, 'id')
    if (!id) return
    const project = await getProjectOr404(res, id)
    if (!project) return
    const { branch } = req.body
    if (!branch || typeof branch !== 'string') return res.status(400).json({ error: 'branch is required' })
    if (!(await requireGitRepo(res, project.workdir))) return
    try {
      const { checkoutBranch } = await import('../git/workspace.js')
      await checkoutBranch(project.workdir, branch)
      await syncBranchToProjectSessions(sessionManager, project.workdir, branch)
      res.json({ branch })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to checkout branch' })
    }
  })

  router.post('/projects/:id/checkout-new', async (req: Request, res: Response) => {
    const id = requireParam(req, res, 'id')
    if (!id) return
    const project = await getProjectOr404(res, id)
    if (!project) return
    const { name, sourceBranch } = req.body
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' })
    if (!(await requireGitRepo(res, project.workdir))) return
    try {
      const { createBranch, resolveAndValidateSourceBranch, validateRef, getDefaultBranch } =
        await import('../git/workspace.js')
      await validateRef(project.workdir, name)
      let sb: string | undefined
      if (sourceBranch) {
        sb = await resolveAndValidateSourceBranch(project.workdir, sourceBranch, project.workdir)
      } else {
        sb = await resolveAndValidateSourceBranch(
          project.workdir,
          await getDefaultBranch(project.workdir),
          project.workdir,
        )
      }
      await createBranch(project.workdir, name, sb)
      await syncBranchToProjectSessions(sessionManager, project.workdir, name)
      res.json({ branch: name, sourceBranch: sourceBranch ?? null })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create branch' })
    }
  })

  router.get('/projects/:id/workspaces', async (req: Request, res: Response) => {
    const id = requireParam(req, res, 'id')
    if (!id) return
    const project = await getProjectOr404(res, id)
    if (!project) return
    const { listWorkspaces } = await import('../git/workspace.js')
    const all = await listWorkspaces(project.name, project.workdir)
    const workspacesList = all.filter((ws) => ws.path !== project.workdir)
    res.json({ workspaces: workspacesList })
  })

  return router
}
