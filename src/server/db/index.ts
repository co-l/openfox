import Database from 'better-sqlite3'
import type { Config } from '../config.js'
import { logger } from '../utils/logger.js'

let db: Database.Database | null = null

export function initDatabase(config: Config): Database.Database {
  if (db) {
    return db
  }

  logger.info('Initializing database', { path: config.database.path })

  db = new Database(config.database.path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  // Reset any stale running states from previous server runs
  // Sessions cannot actually be running when server starts
  const result = db.prepare(`UPDATE sessions SET is_running = 0 WHERE is_running = 1`).run()
  if (result.changes > 0) {
    logger.info('Reset stale running states', { count: result.changes })
  }

  // Vacuum database if freelist has accumulated (deleted rows leave free pages)
  // Only vacuum if > 10k free pages to avoid unnecessary I/O
  const freelistCount = db.pragma('freelist_count', { simple: true }) as number
  if (freelistCount > 10000) {
    logger.info('Vacuuming database', { freelistCount })
    db.exec('VACUUM')
    logger.info('Database vacuumed')
  }

  return db
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.')
  }
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

function runMigrations(db: Database.Database): void {
  logger.info('Running database migrations')

  // Create projects table
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workdir TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  // Create sessions table with project_id
  // Note: mode, phase, isRunning, summary are persisted here for quick access
  // Full session state (messages, criteria, todos) is derived from events table
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
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `)

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)
  `)

  // Migration: Add mode, is_running, summary columns if they don't exist
  const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
  const columnNames = columns.map((c) => c.name)

  if (!columnNames.includes('mode')) {
    logger.info('Migrating sessions table: adding mode column')
    db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'planner'`)
    // Migrate existing phase values to mode
    db.exec(`
      UPDATE sessions SET mode = CASE
        WHEN phase = 'idle' THEN 'planner'
        WHEN phase = 'planning' THEN 'planner'
        WHEN phase = 'executing' THEN 'builder'
        WHEN phase = 'validating' THEN 'verifier'
        WHEN phase = 'completed' THEN 'planner'
        ELSE 'planner'
      END
    `)
  }

  if (!columnNames.includes('is_running')) {
    logger.info('Migrating sessions table: adding is_running column')
    db.exec(`ALTER TABLE sessions ADD COLUMN is_running INTEGER NOT NULL DEFAULT 0`)
  }

  if (!columnNames.includes('summary')) {
    logger.info('Migrating sessions table: adding summary column')
    db.exec(`ALTER TABLE sessions ADD COLUMN summary TEXT`)
  }

  // Note: The old 'phase' column was for the state machine (idle/planning/executing/etc.)
  // This new 'workflow_phase' column is for UI display (plan/build/verification/done)
  if (!columnNames.includes('workflow_phase')) {
    logger.info('Migrating sessions table: adding workflow_phase column')
    db.exec(`ALTER TABLE sessions ADD COLUMN workflow_phase TEXT NOT NULL DEFAULT 'plan'`)
  }

  // Migration: Add danger_level column for dangerous/yolo mode
  if (!columnNames.includes('danger_level')) {
    logger.info('Migrating sessions table: adding danger_level column')
    db.exec(`ALTER TABLE sessions ADD COLUMN danger_level TEXT NOT NULL DEFAULT 'normal'`)
  }

  // Create settings table for global configuration (e.g., global instructions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  // Migration: Add custom_instructions column to projects table
  const projectColumns = db.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[]
  const projectColumnNames = projectColumns.map((c) => c.name)

  if (!projectColumnNames.includes('custom_instructions')) {
    logger.info('Migrating projects table: adding custom_instructions column')
    db.exec(`ALTER TABLE projects ADD COLUMN custom_instructions TEXT`)
  }

  // Create events table for EventStore (single source of truth)
  // Note: EventStore creates this table with its own schema in initSchema()
  // We just ensure the index exists for the event_type column
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

  // Migration: Add per-session provider/model columns
  if (!columnNames.includes('provider_id')) {
    logger.info('Migrating sessions table: adding provider_id column')
    db.exec(`ALTER TABLE sessions ADD COLUMN provider_id TEXT`)
  }

  if (!columnNames.includes('provider_model')) {
    logger.info('Migrating sessions table: adding provider_model column')
    db.exec(`ALTER TABLE sessions ADD COLUMN provider_model TEXT`)
  }

  // Migration: Add message_count column for efficient sidebar message counts
  if (!columnNames.includes('message_count')) {
    logger.info('Migrating sessions table: adding message_count column')
    db.exec(`ALTER TABLE sessions ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0`)

    // Backfill message_count from snapshots OR message.start events
    logger.info('Backfilling message counts')
    const backfillResult = db
      .prepare(
        `
      UPDATE sessions 
      SET message_count = (
        SELECT COALESCE(
          -- First try: get count from latest snapshot
          (SELECT json_array_length(json_extract(
            (SELECT payload FROM events WHERE session_id = sessions.id AND event_type = 'turn.snapshot' ORDER BY seq DESC LIMIT 1),
            '$.messages'
          ))),
          -- Fallback: count message.start events for user/assistant roles
          (SELECT COUNT(*) FROM events e 
           WHERE e.session_id = sessions.id 
           AND e.event_type = 'message.start'
           AND json_extract(e.payload, '$.role') IN ('user', 'assistant'))
        )
      )
    `,
      )
      .run()
    logger.info('Backfilled message counts', { count: backfillResult.changes })
  }

  logger.info('Database migrations completed')
}
