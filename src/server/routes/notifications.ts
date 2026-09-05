import { Router, type Request, type Response } from 'express'
import {
  listNotifications,
  deleteNotification,
  clearNotifications,
  markNotificationsRead,
} from '../db/notifications.js'

export interface BroadcastNotifications {
  /** A notification was deleted. */
  deleted(id: string): void
  /** All notifications were marked as read. */
  read(): void
  /** All notifications were cleared. */
  cleared(): void
}

/**
 * REST API for the global in-app notification history. Mutations broadcast
 * over WebSocket (see registerNotificationRoutes' broadcaster) so live clients
 * stay in sync; responses return the canonical row shape for fetch/reload
 * parity.
 */
export function registerNotificationRoutes(router: Router, broadcast: BroadcastNotifications): void {
  router.get('/notifications', (_req: Request, res: Response) => {
    res.json({ notifications: listNotifications() })
  })

  router.delete('/notifications', (_req: Request, res: Response) => {
    clearNotifications()
    broadcast.cleared()
    res.status(204).end()
  })

  router.post('/notifications/read-all', (_req: Request, res: Response) => {
    markNotificationsRead()
    broadcast.read()
    res.status(204).end()
  })

  router.delete('/notifications/:id', (req: Request, res: Response) => {
    const id = req.params['id'] as string
    deleteNotification(id)
    broadcast.deleted(id)
    res.status(204).end()
  })
}
