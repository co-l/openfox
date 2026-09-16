import { randomBytes } from 'node:crypto'
import type { Notification, NotificationInput } from '../../shared/types.js'
import { getDatabase } from './index.js'

interface NotificationRow {
  id: string
  title: string
  body: string
  source: string
  read: number
  created_at: string
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    source: row.source,
    read: row.read === 1,
    createdAt: row.created_at,
  }
}

export function createNotification(input: NotificationInput): Notification {
  const db = getDatabase()
  const now = new Date().toISOString()
  const row: NotificationRow = {
    id: randomBytes(8).toString('hex'),
    title: input.title,
    body: input.body,
    source: input.source ?? 'system',
    read: 0,
    created_at: now,
  }
  db.prepare(
    `INSERT INTO notifications (id, title, body, source, read, created_at)
     VALUES (@id, @title, @body, @source, @read, @created_at)`,
  ).run(row)
  return toNotification(row)
}

export function listNotifications(): Notification[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC').all() as NotificationRow[]
  return rows.map(toNotification)
}

export function getNotification(id: string): Notification | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as NotificationRow | undefined
  return row ? toNotification(row) : null
}

export function deleteNotification(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM notifications WHERE id = ?').run(id)
}

export function clearNotifications(): void {
  const db = getDatabase()
  db.prepare('DELETE FROM notifications').run()
}

export function markNotificationsRead(): void {
  const db = getDatabase()
  db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run()
}

export function countUnreadNotifications(): number {
  const db = getDatabase()
  const row = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE read = 0').get() as { count: number }
  return row.count
}

export function setNotificationRead(id: string, read: boolean): void {
  const db = getDatabase()
  db.prepare('UPDATE notifications SET read = ? WHERE id = ?').run(read ? 1 : 0, id)
}
