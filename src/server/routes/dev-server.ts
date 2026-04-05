import { Router } from 'express'
import { devServerManager } from '../dev-server/manager.js'

export function createDevServerRoutes(): Router {
  const router = Router()

  // GET / — current status
  router.get('/', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: 'workdir required' })
    const status = devServerManager.getStatus(workdir)
    // If no config loaded yet, try loading it for the status response
    if (!status.config) {
      const config = await devServerManager.loadConfig(workdir)
      if (config) {
        status.config = config
        status.url = config.url
        status.hotReload = config.hotReload
      }
    }
    res.json(status)
  })

  // POST /start
  router.post('/start', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: 'workdir required' })
    try {
      const status = await devServerManager.start(workdir)
      res.json(status)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start' })
    }
  })

  // POST /stop
  router.post('/stop', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: 'workdir required' })
    try {
      const status = await devServerManager.stop(workdir)
      res.json(status)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to stop' })
    }
  })

  // POST /restart
  router.post('/restart', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: 'workdir required' })
    try {
      const status = await devServerManager.restart(workdir)
      res.json(status)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to restart' })
    }
  })

  // GET /logs — full log buffer with pagination
  router.get('/logs', (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: 'workdir required' })
    const offset = Math.max(0, parseInt(req.query['offset'] as string) || 0)
    const limit = Math.max(1, parseInt(req.query['limit'] as string) || Infinity)

    const result = devServerManager.getLogsSlice(workdir, offset, limit)
    res.json({ logs: result.logs, total: result.total, offset, limit })
  })

  // GET /config — read .openfox/dev.json
  router.get('/config', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: 'workdir required' })
    const config = await devServerManager.loadConfig(workdir)
    res.json({ config })
  })

  // POST /config — write .openfox/dev.json
  router.post('/config', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: 'workdir required' })
    const { command, url, hotReload } = req.body
    if (!command || !url) {
      return res.status(400).json({ error: 'command and url are required' })
    }
    try {
      const config = { command, url, hotReload: hotReload ?? false }
      await devServerManager.saveConfig(workdir, config)
      res.json({ config })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save config' })
    }
  })

  return router
}
