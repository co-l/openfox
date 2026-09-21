import { describe, it, expect, beforeEach } from 'vitest'
import { handlePluginMessage } from './plugin-ws'
import { notificationsResource } from './resources'
import { clearCache, snapshot, write } from './resourceCache'
import { usePluginToastStore } from '../stores/pluginToasts'
import { usePluginUiStore } from '../stores/pluginUi'
import type { NotificationsData } from './plugin-actions'
import type { PluginNotification } from '@shared/plugin.js'

const NOTIFICATION: PluginNotification = {
  id: 'n1',
  pluginId: 'demo',
  title: { en: 'Hello', fr: 'Bonjour' },
  level: 'info',
  createdAt: '2026-09-08T10:00:00.000Z',
}

function currentNotifications(): NotificationsData {
  return snapshot<NotificationsData>(notificationsResource.keyOf()).data ?? { notifications: [], unreadCount: 0 }
}

describe('handlePluginMessage', () => {
  beforeEach(() => {
    clearCache()
    usePluginToastStore.setState({ toasts: [] })
    usePluginUiStore.setState({ values: {}, activePanel: null })
  })

  it('writes streamed notifications through the resource and shows a toast', () => {
    handlePluginMessage({
      type: 'plugin.notification',
      payload: { notification: NOTIFICATION, unreadCount: 1 },
    })
    expect(currentNotifications().notifications).toHaveLength(1)
    expect(currentNotifications().unreadCount).toBe(1)
    expect(usePluginToastStore.getState().toasts).toHaveLength(1)
  })

  it('keeps streamed and fetched shapes identical', () => {
    write(notificationsResource.keyOf(), { notifications: [NOTIFICATION], unreadCount: 1 })
    const fetched = currentNotifications()
    handlePluginMessage({
      type: 'plugin.notification',
      payload: { notification: { ...NOTIFICATION, id: 'n2' }, unreadCount: 2 },
    })
    expect(Object.keys(currentNotifications().notifications[0]!)).toEqual(Object.keys(fetched.notifications[0]!))
  })

  it('updates the unread count on read events', () => {
    write(notificationsResource.keyOf(), { notifications: [NOTIFICATION], unreadCount: 1 })
    handlePluginMessage({ type: 'plugin.notification_read', payload: { unreadCount: 0 } })
    expect(currentNotifications().unreadCount).toBe(0)
  })

  it('removes one notification and clears all', () => {
    write(notificationsResource.keyOf(), { notifications: [NOTIFICATION], unreadCount: 1 })
    handlePluginMessage({ type: 'plugin.notification_deleted', payload: { id: 'n1' } })
    expect(currentNotifications().notifications).toHaveLength(0)

    write(notificationsResource.keyOf(), { notifications: [NOTIFICATION], unreadCount: 1 })
    handlePluginMessage({ type: 'plugin.notification_deleted', payload: { all: true } })
    expect(currentNotifications()).toEqual({ notifications: [], unreadCount: 0 })
  })

  it('stores published panel state', () => {
    handlePluginMessage({
      type: 'plugin.ui_state',
      payload: { pluginId: 'demo', panelId: 'quota', key: 'tokens', value: 42 },
    })
    expect(usePluginUiStore.getState().read('demo', 'quota', 'tokens')).toBe(42)
  })

  it('ignores unrelated messages', () => {
    expect(handlePluginMessage({ type: 'chat.delta', payload: {} })).toBe(false)
  })
})
