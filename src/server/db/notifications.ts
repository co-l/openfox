import { getDatabase } from './index.js'
import type {
  LocalizedString,
  PluginNotification,
  PluginNotificationAction,
  PluginNotificationLevel,
} from '../../shared/plugin.js'

interface NotificationRow {
  id: string
  plugin_id: string
  title: string
  body: string | null
  level: string
  actions: string | null
  created_at: string
  read_at: string | null
}

function parseLocalizedString(value: string | null): LocalizedString | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed === 'string') {
      return { en: parsed, fr: parsed }
    }
    if (parsed && typeof parsed === 'object' && 'en' in parsed) {
      return parsed as LocalizedString
    }
    return { en: String(parsed), fr: String(parsed) }
  } catch {
    return { en: value, fr: value }
  }
}

function parseActions(value: string | null): PluginNotificationAction[] | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as PluginNotificationAction[]
  } catch {
    return undefined
  }
}

function toNotification(row: NotificationRow): PluginNotification {
  const title = parseLocalizedString(row.title) ?? { en: row.title, fr: row.title }
  const body = parseLocalizedString(row.body)
  const actions = parseActions(row.actions)
  return {
    id: row.id,
    pluginId: row.plugin_id,
    title,
    ...(body ? { body } : {}),
    level: row.level as PluginNotificationLevel,
    ...(actions ? { actions } : {}),
    createdAt: row.created_at,
    ...(row.read_at ? { readAt: row.read_at } : {}),
  }
}

export function insertNotification(notification: PluginNotification): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO notifications (id, plugin_id, title, body, level, actions, created_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    notification.id,
    notification.pluginId,
    JSON.stringify(notification.title),
    notification.body ? JSON.stringify(notification.body) : null,
    notification.level,
    notification.actions ? JSON.stringify(notification.actions) : null,
    notification.createdAt,
    notification.readAt ?? null,
  )
}

export function listNotifications(limit = 100): PluginNotification[] {
  const db = getDatabase()
  const rows = db
    .prepare(`SELECT * FROM notifications ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(limit) as NotificationRow[]
  return rows.map(toNotification)
}

export function markNotificationRead(id: string): void {
  const db = getDatabase()
  db.prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL`).run(new Date().toISOString(), id)
}

export function markAllNotificationsRead(): void {
  const db = getDatabase()
  db.prepare(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL`).run(new Date().toISOString())
}

export function deleteNotification(id: string): void {
  getDatabase().prepare(`DELETE FROM notifications WHERE id = ?`).run(id)
}

export function clearNotifications(): void {
  getDatabase().prepare(`DELETE FROM notifications`).run()
}

export function countUnreadNotifications(): number {
  const row = getDatabase().prepare(`SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL`).get() as {
    count: number
  }
  return row.count
}
