import { useResource } from './useResource'
import { notificationsResource, readNotifications } from '../lib/resources'
import { authFetch } from '../lib/api'

export async function deleteNotification(id: string): Promise<void> {
  try {
    await authFetch(`/api/notifications/${id}`, { method: 'DELETE' })
    const current = readNotifications() ?? []
    notificationsResource.write(current.filter((n) => n.id !== id))
  } catch {
    // Keep stale row; a later refetch reconciles.
  }
}

export async function clearAllNotifications(): Promise<void> {
  try {
    await authFetch('/api/notifications', { method: 'DELETE' })
    notificationsResource.write([])
  } catch {
    // ignore
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  try {
    await authFetch('/api/notifications/read-all', { method: 'POST' })
    const current = readNotifications() ?? []
    notificationsResource.write(current.map((n) => ({ ...n, read: true })))
  } catch {
    // ignore
  }
}

export function useNotifications() {
  const { data, refresh, loading } = useResource(notificationsResource)
  const notifications = data ?? []
  const unreadCount = notifications.filter((n) => !n.read).length

  return {
    notifications,
    unreadCount,
    refresh,
    loading,
    deleteNotification,
    clearAll: clearAllNotifications,
    markAllRead: markAllNotificationsRead,
  }
}
