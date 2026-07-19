import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from './index.js'

function createOldSchemaDatabase(dbPath: string): void {
  const db = new Database(dbPath)

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workdir TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  // Old sessions schema: has worktree column, does NOT have workspace column
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workdir TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title TEXT,
      total_tokens_used INTEGER DEFAULT 0,
      total_tool_calls INTEGER DEFAULT 0,
      iteration_count INTEGER DEFAULT 0,
      mode TEXT NOT NULL DEFAULT 'planner',
      is_running INTEGER NOT NULL DEFAULT 0,
      workflow_phase TEXT NOT NULL DEFAULT 'plan',
      danger_level TEXT NOT NULL DEFAULT 'normal',
      provider_id TEXT,
      provider_model TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      cached_system_prompt TEXT,
      cached_tools TEXT,
      cached_hash TEXT,
      worktree TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      UNIQUE(session_id, seq),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, seq)
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_session_type ON events(session_id, event_type)
  `)

  // Insert a dummy project and session so the DB is not empty
  db.prepare(`INSERT INTO projects (id, name, workdir, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
    'test-proj',
    'Test Project',
    '/tmp/test',
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
  )
  db.prepare(
    `INSERT INTO sessions (id, project_id, workdir, phase, created_at, updated_at, worktree) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'test-session',
    'test-proj',
    '/tmp/test',
    'idle',
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
    '/tmp/test-worktree',
  )

  db.close()
}

describe('db migrations', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(async () => {
    closeDatabase()
    tmpDir = await mkdtemp(join(tmpdir(), 'openfox-migration-test-'))
    dbPath = join(tmpDir, 'test.db')
  })

  afterEach(async () => {
    closeDatabase()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('migrates worktree column to workspace on upgrade from old schema', () => {
    // Create a database with the old schema (has worktree, no workspace)
    createOldSchemaDatabase(dbPath)

    // Run migrations via initDatabase
    const config = loadConfig()
    config.database.path = dbPath
    initDatabase(config)

    // Verify the sessions table now has workspace instead of worktree
    const db = new Database(dbPath)
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
    const columnNames = columns.map((c) => c.name)

    expect(columnNames).toContain('workspace')
    expect(columnNames).not.toContain('worktree')

    // Verify the data survived the migration
    const session = db.prepare(`SELECT workspace FROM sessions WHERE id = ?`).get('test-session') as {
      workspace: string | null
    }
    expect(session.workspace).toBe('/tmp/test-worktree')

    db.close()
  })

  it('is idempotent — running migrations twice does not crash', () => {
    // Create old schema and run migrations once
    createOldSchemaDatabase(dbPath)

    const config = loadConfig()
    config.database.path = dbPath
    initDatabase(config)
    closeDatabase()

    // Run migrations again (simulating server restart)
    expect(() => {
      const config2 = loadConfig()
      config2.database.path = dbPath
      initDatabase(config2)
    }).not.toThrow()

    // Verify schema is still correct after second migration run
    const db = new Database(dbPath)
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
    const columnNames = columns.map((c) => c.name)

    expect(columnNames).toContain('workspace')
    expect(columnNames).not.toContain('worktree')

    db.close()
  })

  it('adds workspace column when neither worktree nor workspace exists', () => {
    // Create a fresh database (no worktree, no workspace — the initial
    // CREATE TABLE already has workdir, not worktree)
    const config = loadConfig()
    config.database.path = dbPath
    initDatabase(config)

    const db = new Database(dbPath)
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
    const columnNames = columns.map((c) => c.name)

    // Fresh DB should have workspace added by the else-if branch
    expect(columnNames).toContain('workspace')
    expect(columnNames).not.toContain('worktree')

    db.close()
  })
})
