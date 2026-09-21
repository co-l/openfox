import { notificationsResource } from './resources'
import { snapshot, write } from './resourceCache'
import { usePluginToastStore } from '../stores/pluginToasts'
import { usePluginUiStore } from '../stores/pluginUi'
import type { NotificationsData } from './plugin-actions'
import type { ServerMessage } from '@shared/protocol.js'
import type { PluginNotification } from '@shared/plugin.js'

const NOTIFICATIONS_KEY = notificationsResource.keyOf()

function current(): NotificationsData {
  return snapshot<NotificationsData>(NOTIFICATIONS_KEY).data ?? { notifications: [], unreadCount: 0 }
}

export function handlePluginMessage(message: ServerMessage): boolean {
  switch (message.type) {
    case 'plugin.notification': {
      const payload = message.payload as { notification: PluginNotification; unreadCount: number }
      const previous = current()
      write(NOTIFICATIONS_KEY, {
        notifications: [
          payload.notification,
          ...previous.notifications.filter((n) => n.id !== payload.notification.id),
        ],
        unreadCount: payload.unreadCount,
      })
      usePluginToastStore.getState().push(payload.notification)
      return true
    }
    case 'plugin.notification_read': {
      const payload = message.payload as { unreadCount: number }
      write(NOTIFICATIONS_KEY, { ...current(), unreadCount: payload.unreadCount })
      return true
    }
    case 'plugin.notification_deleted': {
      const payload = message.payload as { id?: string; all?: boolean }
      const previous = current()
      if (payload.all) {
        write(NOTIFICATIONS_KEY, { notifications: [], unreadCount: 0 })
        return true
      }
      const notifications = previous.notifications.filter((notification) => notification.id !== payload.id)
      write(NOTIFICATIONS_KEY, {
        notifications,
        unreadCount: notifications.filter((notification) => !notification.readAt).length,
      })
      return true
    }
    case 'plugin.ui_state': {
      const payload = message.payload as {
        pluginId: string
        panelId?: string
        key: string
        value: unknown
      }
      usePluginUiStore.getState().setState(payload.pluginId, payload.panelId, payload.key, payload.value)
      return true
    }
    default:
      return false
  }
}
