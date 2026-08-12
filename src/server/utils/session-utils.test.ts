/**
 * Session Utils Tests
 *
 * Covers helpers in src/server/utils/session-utils.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initEventStore } from '../events/store.js'
import { emitSessionInitialized, emitUserMessage } from '../events/session.js'
import { getSessionMessageCount } from './session-utils.js'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workdir TEXT NOT NULL
    )
  `)
  initEventStore(db)
})

afterEach(() => {
  db.close()
})

describe('getSessionMessageCount', () => {
  it('counts real user messages', () => {
    emitSessionInitialized('s1', 'proj-1', '/tmp/test', 'win-1')
    emitUserMessage('s1', 'Hello')
    expect(getSessionMessageCount('s1')).toBe(1)
  })

  it('ignores system-generated user messages', () => {
    emitSessionInitialized('s1', 'proj-1', '/tmp/test', 'win-1')
    emitUserMessage('s1', '<system-reminder>\nThis session is now working on a task.\n</system-reminder>', {
      isSystemGenerated: true,
    })
    emitUserMessage('s1', 'Fix the login flow')
    expect(getSessionMessageCount('s1')).toBe(1)
  })
})
