import { Router } from 'express'
import { terminalManager } from '../terminal/manager.js'

export interface TerminalSessionResponse {
  id: string
  workdir: string
  projectId: string
}

export function createTerminalRoutes(): Router {
  const router = Router()

  router.get('/', (req, res) => {
    const projectId = req.query['projectId'] as string | undefined
    const sessions = projectId ? terminalManager.getByProject(projectId) : []
    const response: TerminalSessionResponse[] = sessions.map((s) => ({
      id: s.id,
      workdir: s.workdir,
      projectId: s.projectId,
    }))
    res.json(response)
  })

  router.post('/', (req, res) => {
    const workdir = req.body?.workdir as string | undefined
    const projectId = req.body?.projectId as string | undefined
    const session = terminalManager.create(workdir, projectId)
    res.status(201).json({ id: session.id, workdir: session.workdir, projectId: session.projectId })
  })

  router.delete('/:id', (req, res) => {
    const { id } = req.params
    const success = terminalManager.kill(id)
    if (success) {
      res.status(204).send()
    } else {
      res.status(404).json({ error: 'Terminal not found' })
    }
  })

  router.get('/:id', (req, res) => {
    const { id } = req.params
    const session = terminalManager.get(id)
    if (session) {
      res.json({ id: session.id, workdir: session.workdir })
    } else {
      res.status(404).json({ error: 'Terminal not found' })
    }
  })

  return router
}
