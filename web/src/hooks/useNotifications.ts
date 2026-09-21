import { useCallback } from 'react'
import { useResource } from './useResource'
import { notificationsResource } from '../lib/resources'
import {
  clearNotifications,
  deleteNotification,
  markNotificationsRead,
  type NotificationsData,
} from '../lib/plugin-actions'

export function useNotifications() {
  const { data, loading, refresh } = useResource(notificationsResource)

  const markAllRead = useCallback(async () => {
    await markNotificationsRead()
    await refresh()
  }, [refresh])

  const markRead = useCallback(
    async (id: string) => {
      await markNotificationsRead(id)
      await refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteNotification(id)
      await refresh()
    },
    [refresh],
  )

  const clear = useCallback(async () => {
    await clearNotifications()
    await refresh()
  }, [refresh])

  const snapshot: NotificationsData = data ?? { notifications: [], unreadCount: 0 }

  return {
    notifications: snapshot.notifications ?? [],
    unreadCount: snapshot.unreadCount ?? 0,
    loading,
    refresh,
    markAllRead,
    markRead,
    remove,
    clear,
  }
}
