import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from '../db/index.js'
import {
  createNotification,
  listNotifications,
  deleteNotification,
  clearNotifications,
  markNotificationsRead,
  countUnreadNotifications,
  setNotificationRead,
  getNotification,
} from '../db/notifications.js'

describe('notifications db', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(async () => {
    closeDatabase()
    tmpDir = await mkdtemp(join(tmpdir(), 'openfox-notif-test-'))
    dbPath = join(tmpDir, 'test.db')
    const config = loadConfig()
    config.database.path = dbPath
    initDatabase(config)
  })

  afterEach(async () => {
    closeDatabase()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('creates and lists notifications newest first', () => {
    createNotification({ title: 'First', body: 'body 1', source: 'plugin' })
    const second = createNotification({ title: 'Second', body: 'body 2' })

    const all = listNotifications()
    expect(all.length).toBe(2)
    // Newest first: second (just created) first
    expect(all[0]!.id).toBe(second.id)
    expect(all[0]!.source).toBe('system')
    expect(all[1]!.source).toBe('plugin')
    expect(all[0]!.read).toBe(false)
  })

  it('tracks unread count', () => {
    createNotification({ title: 'A', body: 'a' })
    const b = createNotification({ title: 'B', body: 'b' })
    expect(countUnreadNotifications()).toBe(2)

    setNotificationRead(b.id, true)
    expect(countUnreadNotifications()).toBe(1)

    markNotificationsRead()
    expect(countUnreadNotifications()).toBe(0)
  })

  it('deletes a single notification', () => {
    const a = createNotification({ title: 'A', body: 'a' })
    createNotification({ title: 'B', body: 'b' })
    deleteNotification(a.id)

    expect(listNotifications().length).toBe(1)
    expect(getNotification(a.id)).toBeNull()
  })

  it('clears all notifications', () => {
    createNotification({ title: 'A', body: 'a' })
    createNotification({ title: 'B', body: 'b' })
    clearNotifications()

    expect(listNotifications()).toEqual([])
    expect(countUnreadNotifications()).toBe(0)
  })

  it('persists a test notification source', () => {
    const n = createNotification({ title: 'Test', body: 'sample', source: 'test' })
    expect(n.source).toBe('test')

    const all = listNotifications()
    expect(all[0]!.title).toBe('Test')
    expect(all[0]!.source).toBe('test')
  })
})
