import { Router } from 'express'
import { devServerManager } from '../dev-server/manager.js'
import { serverT } from '../i18n.js'

export function createDevServerRoutes(): Router {
  const router = Router()

  // GET / — current status
  router.get('/', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: serverT({ en: 'workdir required', fr: 'workdir requis' }) })
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
    if (!workdir) return res.status(400).json({ error: serverT({ en: 'workdir required', fr: 'workdir requis' }) })
    try {
      const status = await devServerManager.start(workdir)
      res.json(status)
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : serverT({ en: 'Failed to start', fr: 'Échec du démarrage' }),
      })
    }
  })

  // POST /stop
  router.post('/stop', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: serverT({ en: 'workdir required', fr: 'workdir requis' }) })
    try {
      const status = await devServerManager.stop(workdir)
      res.json(status)
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : serverT({ en: 'Failed to stop', fr: 'Échec de l’arrêt' }) })
    }
  })

  // POST /restart
  router.post('/restart', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: serverT({ en: 'workdir required', fr: 'workdir requis' }) })
    try {
      const status = await devServerManager.restart(workdir)
      res.json(status)
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : serverT({ en: 'Failed to restart', fr: 'Échec du redémarrage' }),
      })
    }
  })

  // GET /logs — full log buffer with pagination
  router.get('/logs', (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: serverT({ en: 'workdir required', fr: 'workdir requis' }) })
    const offset = Math.max(0, parseInt(req.query['offset'] as string) || 0)
    const limit = Math.max(1, parseInt(req.query['limit'] as string) || Infinity)

    const result = devServerManager.getLogsSlice(workdir, offset, limit)
    res.json({ logs: result.logs, total: result.total, offset, limit })
  })

  // POST /clear-logs — clear log buffer
  router.post('/clear-logs', (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: serverT({ en: 'workdir required', fr: 'workdir requis' }) })
    try {
      devServerManager.clearLogs(workdir)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : serverT({ en: 'Failed to clear logs', fr: 'Échec de l’effacement des journaux' }),
      })
    }
  })

  // POST /insert-marker — insert a visual marker divider into logs
  router.post('/insert-marker', (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: serverT({ en: 'workdir required', fr: 'workdir requis' }) })
    try {
      devServerManager.insertMarker(workdir)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : serverT({ en: 'Failed to insert marker', fr: 'Échec de l’insertion du marqueur' }),
      })
    }
  })

  // GET /config — read .openfox/dev.json
  router.get('/config', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: serverT({ en: 'workdir required', fr: 'workdir requis' }) })
    const config = await devServerManager.loadConfig(workdir)
    res.json({ config })
  })

  // POST /config — write .openfox/dev.json
  router.post('/config', async (req, res) => {
    const workdir = req.query['workdir'] as string
    if (!workdir) return res.status(400).json({ error: serverT({ en: 'workdir required', fr: 'workdir requis' }) })
    const { command, url, hotReload, disableInspect } = req.body
    if (!command || !url) {
      return res.status(400).json({
        error: serverT({ en: 'command and url are required', fr: 'command et url sont requis' }),
      })
    }
    try {
      const config = { command, url, hotReload: hotReload ?? false, disableInspect: disableInspect ?? false }
      await devServerManager.saveConfig(workdir, config)
      res.json({ config })
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : serverT({ en: 'Failed to save config', fr: 'Échec de l’enregistrement de la configuration' }),
      })
    }
  })

  return router
}
