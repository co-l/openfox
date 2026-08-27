import type { Notification, NotificationInput } from '../../shared/types.js'
import { createNotification as dbCreateNotification } from '../db/notifications.js'

export type NotificationsBroadcaster = {
  /** Broadcast a newly created notification to all clients. */
  notify(notification: Notification): void
}

/**
 * Global in-app notification service. Persists the notification row and pushes
 * it to every connected UI. The broadcaster is injected so the service works
 * before the WebSocket server exists (deferred wiring in the server entry) and
 * stays testable.
 */
export class NotificationsService {
  constructor(private broadcaster: NotificationsBroadcaster) {}

  notify(input: NotificationInput): Notification {
    const notification = dbCreateNotification(input)
    this.broadcaster.notify(notification)
    return notification
  }
}

export function createNotificationsService(broadcaster: NotificationsBroadcaster): NotificationsService {
  return new NotificationsService(broadcaster)
}
