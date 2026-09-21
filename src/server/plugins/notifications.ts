import { randomUUID } from 'node:crypto'
import type { ServerMessage } from '../../shared/protocol.js'
import { createServerMessage } from '../../shared/protocol.js'
import type { PluginNotification, PluginNotificationLevel } from '../../shared/plugin.js'
import type { PluginNotificationRequest } from '../../plugin/index.js'
import {
  clearNotifications,
  countUnreadNotifications,
  deleteNotification,
  insertNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../db/notifications.js'

export interface NotificationBroadcaster {
  (message: ServerMessage): void
}

export class NotificationService {
  private broadcaster: NotificationBroadcaster | undefined

  setBroadcaster(broadcaster: NotificationBroadcaster): void {
    this.broadcaster = broadcaster
  }

  emit(pluginId: string, request: PluginNotificationRequest): PluginNotification {
    const notification: PluginNotification = {
      id: randomUUID(),
      pluginId,
      title: request.title,
      ...(request.body ? { body: request.body } : {}),
      level: (request.level ?? 'info') as PluginNotificationLevel,
      ...(request.actions && request.actions.length > 0 ? { actions: request.actions } : {}),
      createdAt: new Date().toISOString(),
    }
    insertNotification(notification)
    this.broadcaster?.(
      createServerMessage('plugin.notification', {
        notification,
        unreadCount: countUnreadNotifications(),
      }),
    )
    return notification
  }

  list(limit = 100): { notifications: PluginNotification[]; unreadCount: number } {
    return { notifications: listNotifications(limit), unreadCount: countUnreadNotifications() }
  }

  markRead(id: string): void {
    markNotificationRead(id)
    this.broadcastList()
  }

  markAllRead(): void {
    markAllNotificationsRead()
    this.broadcastList()
  }

  remove(id: string): void {
    deleteNotification(id)
    this.broadcaster?.(createServerMessage('plugin.notification_deleted', { id }))
  }

  clear(): void {
    clearNotifications()
    this.broadcaster?.(createServerMessage('plugin.notification_deleted', { all: true }))
  }

  private broadcastList(): void {
    const { unreadCount } = this.list()
    this.broadcaster?.(createServerMessage('plugin.notification_read', { unreadCount }))
  }
}
