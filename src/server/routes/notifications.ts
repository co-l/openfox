import { Router } from 'express'
import { serverT } from '../i18n.js'
import type { NotificationService } from '../plugins/notifications.js'

export function createNotificationRoutes(notifications: NotificationService): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(notifications.list())
  })

  router.post('/read', (req, res) => {
    const body = (req.body ?? {}) as { id?: string; all?: boolean }
    if (body.all) {
      notifications.markAllRead()
      return res.json(notifications.list())
    }
    if (typeof body.id === 'string' && body.id) {
      notifications.markRead(body.id)
      return res.json(notifications.list())
    }
    return res.status(400).json({ error: serverT({ en: 'id or all is required', fr: 'id ou all est requis' }) })
  })

  router.delete('/:id', (req, res) => {
    notifications.remove(req.params.id as string)
    res.json(notifications.list())
  })

  router.delete('/', (_req, res) => {
    notifications.clear()
    res.json(notifications.list())
  })

  return router
}
