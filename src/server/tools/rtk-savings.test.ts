import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getRtkHistoryDbPath, getRtkSessionSavedTokens } from './rtk-savings.js'

const WORKDIR = '/repo/project'
const SINCE = '2026-09-10T12:00:00.000Z'

let dir: string
let dbPath: string

/** Create an RTK-shaped history database seeded with the given commands. */
function seed(rows: Array<{ timestamp: string; projectPath: string; saved: number }>): void {
  const db = new Database(dbPath)
  db.exec(`CREATE TABLE commands (
    id INTEGER PRIMARY KEY,
    timestamp TEXT NOT NULL,
    original_cmd TEXT NOT NULL,
    rtk_cmd TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    saved_tokens INTEGER NOT NULL,
    savings_pct REAL NOT NULL,
    exec_time_ms INTEGER DEFAULT 0,
    project_path TEXT DEFAULT ''
  )`)
  const insert = db.prepare(
    `INSERT INTO commands
       (timestamp, original_cmd, rtk_cmd, input_tokens, output_tokens, saved_tokens, savings_pct, project_path)
     VALUES (?, 'ls', 'rtk ls', 0, 0, ?, 0, ?)`,
  )
  for (const row of rows) {
    insert.run(row.timestamp, row.saved, row.projectPath)
  }
  db.close()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rtk-savings-'))
  dbPath = join(dir, 'history.db')
  process.env['RTK_DB_PATH'] = dbPath
})

afterEach(() => {
  delete process.env['RTK_DB_PATH']
  // Windows can hold the sqlite file briefly after close; retry the removal.
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('getRtkHistoryDbPath', () => {
  it('prefers the RTK_DB_PATH override', () => {
    expect(getRtkHistoryDbPath()).toBe(dbPath)
  })
})

describe('getRtkSessionSavedTokens', () => {
  it('sums saved tokens for the session project since the session start', () => {
    seed([
      { timestamp: '2026-09-10T12:30:00.000000+00:00', projectPath: WORKDIR, saved: 500 },
      { timestamp: '2026-09-10T13:00:00.000000+00:00', projectPath: `${WORKDIR}/web`, saved: 250 },
      { timestamp: '2026-09-10T13:30:00.000000+00:00', projectPath: '/repo/other', saved: 9999 },
      { timestamp: '2026-09-10T11:00:00.000000+00:00', projectPath: WORKDIR, saved: 7777 },
    ])

    expect(getRtkSessionSavedTokens(WORKDIR, SINCE)).toBe(750)
  })

  it('treats LIKE wildcards in the workdir as literal characters', () => {
    seed([
      { timestamp: '2026-09-10T13:00:00.000000+00:00', projectPath: '/repo/my_project', saved: 120 },
      { timestamp: '2026-09-10T13:00:00.000000+00:00', projectPath: '/repo/myXproject/sub', saved: 5000 },
    ])

    expect(getRtkSessionSavedTokens('/repo/my_project', SINCE)).toBe(120)
  })

  it('matches subdirectories regardless of the path separator', () => {
    seed([
      { timestamp: '2026-09-10T13:00:00.000000+00:00', projectPath: 'C:\\repo\\project', saved: 300 },
      { timestamp: '2026-09-10T13:05:00.000000+00:00', projectPath: 'C:\\repo\\project\\web', saved: 200 },
      { timestamp: '2026-09-10T13:10:00.000000+00:00', projectPath: 'C:\\repo\\other', saved: 9999 },
    ])

    expect(getRtkSessionSavedTokens('C:\\repo\\project', SINCE)).toBe(500)
  })

  it('returns 0 when the history database is missing', () => {
    rmSync(dbPath, { force: true })
    expect(getRtkSessionSavedTokens(WORKDIR, SINCE)).toBe(0)
  })

  it('returns 0 when the history database is unreadable', () => {
    writeFileSync(dbPath, 'not a sqlite database')
    expect(getRtkSessionSavedTokens(WORKDIR, SINCE)).toBe(0)
  })

  it('returns 0 when the schema is unknown', () => {
    const db = new Database(dbPath)
    db.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)')
    db.close()
    expect(getRtkSessionSavedTokens(WORKDIR, SINCE)).toBe(0)
  })

  it('returns 0 without a workdir or start time', () => {
    expect(getRtkSessionSavedTokens('', SINCE)).toBe(0)
    expect(getRtkSessionSavedTokens(WORKDIR, '')).toBe(0)
  })
})
