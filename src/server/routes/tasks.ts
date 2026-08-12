import { Router, type Request, type Response } from 'express'
import type { TasksService } from '../tasks/service.js'
import { isTaskGateError, isTaskConflictError } from '../tasks/service.js'
import type { TaskActor } from '../../shared/types.js'
import { getProject } from '../db/projects.js'
import { getGateConfig, getTaskSettings } from '../db/tasks.js'

/**
 * REST API for the project task board. All mutations funnel through the
 * tasks service so transition/gate enforcement is server-side. Static routes
 * (gates, settings, count) are registered before the :taskId routes to avoid
 * path collisions.
 */
export function registerTaskRoutes(router: Router, tasksService: TasksService): void {
  const requireProject = (req: Request, res: Response): string | null => {
    const projectId = req.params['projectId'] as string
    if (!getProject(projectId)) {
      res.status(404).json({ error: 'Project not found' })
      return null
    }
    return projectId
  }

  const handleError = (res: Response, error: unknown) => {
    if (isTaskGateError(error)) {
      return res.status(422).json({
        error: error.message,
        code: 'GATE_BLOCKED',
        missing: error.missing,
        task: error.task,
      })
    }
    if (isTaskConflictError(error)) {
      return res.status(409).json({ error: error.message, code: 'CONFLICT', task: error.task })
    }
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' })
  }

  const HUMAN: TaskActor = 'human'

  // Board overview (static, registered before :taskId routes)
  router.get('/projects/:projectId/tasks', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    res.json(tasksService.snapshot(projectId))
  })

  router.get('/projects/:projectId/tasks/count', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    res.json({ counts: tasksService.counts(projectId) })
  })

  router.get('/projects/:projectId/tasks/gates', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    res.json({ gates: getGateConfig(projectId) })
  })

  router.put('/projects/:projectId/tasks/gates', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    const { gates } = req.body
    if (!Array.isArray(gates)) {
      return res.status(400).json({ error: 'gates (array) is required' })
    }
    const normalized = gates.map(
      (
        g: { id?: unknown; name?: unknown; description?: unknown; required?: unknown; variant?: unknown },
        i: number,
      ) => ({
        id: typeof g?.id === 'string' && g.id ? g.id : `gate_${i}`,
        name: typeof g?.name === 'string' && g.name ? g.name : `Gate ${i + 1}`,
        description: typeof g?.description === 'string' ? g.description : '',
        required: g?.required !== false,
        variant: (g?.variant === 'ready' ? 'ready' : 'done') as 'ready' | 'done',
      }),
    )
    res.json({ gates: tasksService.setGateConfig(projectId, normalized, { actor: HUMAN }) })
  })

  router.get('/projects/:projectId/tasks/settings', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    res.json({ settings: getTaskSettings(projectId) })
  })

  router.put('/projects/:projectId/tasks/settings', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    const { slotLimit, queuePaused } = req.body
    const settings: { slotLimit?: number; queuePaused?: boolean } = {}
    if (typeof slotLimit === 'number') {
      if (!Number.isInteger(slotLimit) || slotLimit < 1 || slotLimit > 10) {
        return res.status(400).json({ error: 'slotLimit must be an integer between 1 and 10' })
      }
      settings.slotLimit = slotLimit
    }
    if (typeof queuePaused === 'boolean') settings.queuePaused = queuePaused
    if (Object.keys(settings).length === 0) {
      return res.status(400).json({ error: 'Provide slotLimit and/or queuePaused' })
    }
    tasksService.setSettings(projectId, settings).then((saved) => {
      res.json({ settings: saved })
    })
  })

  // Task CRUD (dynamic routes)
  router.post('/projects/:projectId/tasks', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    const { prompt, attachments, agentId, providerId, model } = req.body
    if (typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt (string) is required' })
    }
    try {
      const task = tasksService.create(
        projectId,
        {
          prompt,
          ...(Array.isArray(attachments) ? { attachments } : {}),
          ...(typeof agentId === 'string' ? { agentId } : {}),
          ...(typeof providerId === 'string' ? { providerId } : {}),
          ...(typeof model === 'string' ? { model } : {}),
        },
        { actor: HUMAN },
      )
      res.status(201).json({ task })
    } catch (error) {
      handleError(res, error)
    }
  })

  router.get('/projects/:projectId/tasks/:taskId', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    const task = tasksService.get(projectId, req.params['taskId'] as string)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    res.json({ task })
  })

  router.put('/projects/:projectId/tasks/:taskId', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    const { prompt, attachments, agentId, providerId, model, expectedVersion } = req.body
    const patch: {
      prompt?: string
      attachments?: import('../../shared/types.js').Attachment[]
      agentId?: string | null
      providerId?: string | null
      model?: string | null
    } = {}
    if (typeof prompt === 'string') patch.prompt = prompt
    if (Array.isArray(attachments)) {
      patch.attachments = attachments as import('../../shared/types.js').Attachment[]
    }
    if (typeof agentId === 'string' || agentId === null) patch.agentId = agentId
    if (typeof providerId === 'string' || providerId === null) patch.providerId = providerId
    if (typeof model === 'string' || model === null) patch.model = model
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' })
    }
    tasksService
      .update(projectId, req.params['taskId'] as string, patch, { actor: HUMAN }, expectedVersion)
      .then(({ task }) => res.json({ task }))
      .catch((error) => handleError(res, error))
  })

  router.delete('/projects/:projectId/tasks/:taskId', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    tasksService
      .remove(projectId, req.params['taskId'] as string, { actor: HUMAN })
      .then(() => res.status(204).end())
      .catch((error) => handleError(res, error))
  })

  router.post('/projects/:projectId/tasks/:taskId/duplicate', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    try {
      const task = tasksService.duplicate(projectId, req.params['taskId'] as string, { actor: HUMAN })
      res.status(201).json({ task })
    } catch (error) {
      handleError(res, error)
    }
  })

  router.post('/projects/:projectId/tasks/:taskId/move', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    const { to, reason, expectedVersion } = req.body
    if (!['todo', 'in_progress', 'done'].includes(to)) {
      return res.status(400).json({ error: 'to must be one of: todo, in_progress, done' })
    }
    tasksService
      .move(projectId, req.params['taskId'] as string, to, {
        actor: HUMAN,
        ...(typeof reason === 'string' ? { reason } : {}),
        ...(typeof expectedVersion === 'number' ? { expectedVersion } : {}),
      })
      .then((result) => res.json(result))
      .catch((error) => handleError(res, error))
  })

  router.put('/projects/:projectId/tasks/:taskId/gate-values/:gateId', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    const { value, expectedVersion } = req.body
    if (typeof value !== 'string') {
      return res.status(400).json({ error: 'value (string) is required' })
    }
    tasksService
      .setGateValue(
        projectId,
        req.params['taskId'] as string,
        req.params['gateId'] as string,
        value,
        { actor: HUMAN },
        undefined,
        expectedVersion,
      )
      .then(({ task }) => res.json({ task }))
      .catch((error) => handleError(res, error))
  })

  router.post('/projects/:projectId/tasks/:taskId/reorder', (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (!projectId) return
    const { status, index } = req.body
    if (!['todo', 'in_progress', 'done'].includes(status) || typeof index !== 'number') {
      return res.status(400).json({ error: 'status and index (number) are required' })
    }
    try {
      res.json({ task: tasksService.reorder(projectId, req.params['taskId'] as string, status, index) })
    } catch (error) {
      handleError(res, error)
    }
  })
}
