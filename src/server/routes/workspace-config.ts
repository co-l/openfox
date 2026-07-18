import { Router } from 'express'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '../git/workspace-config.js'

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
    const { setup } = req.body
    if (!Array.isArray(setup)) {
      return res.status(400).json({ error: 'setup must be an array of strings' })
    }
    try {
      const config = { setup }
      await saveWorkspaceConfig(workdir, config)
      res.json({ config })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save config' })
    }
  })

  return router
}
