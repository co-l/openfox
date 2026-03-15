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
  
  // Create messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      thinking_content TEXT,
      tool_call_id TEXT,
      tool_name TEXT,
      tool_result TEXT,
      timestamp TEXT NOT NULL,
      token_count INTEGER DEFAULT 0,
      is_compacted INTEGER DEFAULT 0,
      original_message_ids TEXT,
      segments TEXT,
      stats TEXT,
      partial INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `)
  
  // Migration: add stats column if missing
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN stats TEXT`)
  } catch {
    // Column already exists
  }
  
  // Migration: add partial column if missing
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN partial INTEGER DEFAULT 0`)
  } catch {
    // Column already exists
  }
  
  // Migration: add is_system_generated column if missing
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN is_system_generated INTEGER DEFAULT 0`)
  } catch {
    // Column already exists
  }
  
  // Migration: add is_streaming column if missing
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN is_streaming INTEGER DEFAULT 0`)
  } catch {
    // Column already exists
  }
  
  // Migration: add message_kind column if missing
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN message_kind TEXT`)
  } catch {
    // Column already exists
  }
  
  // Migration: add sub_agent_id column if missing
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN sub_agent_id TEXT`)
  } catch {
    // Column already exists
  }
  
  // Migration: add sub_agent_type column if missing
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN sub_agent_type TEXT`)
  } catch {
    // Column already exists
  }
  
  // Create criteria table
  db.exec(`
    CREATE TABLE IF NOT EXISTS criteria (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts TEXT DEFAULT '[]',
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `)
  
  // Create execution_state table
  db.exec(`
    CREATE TABLE IF NOT EXISTS execution_state (
      session_id TEXT PRIMARY KEY,
      iteration INTEGER DEFAULT 0,
      modified_files TEXT DEFAULT '[]',
      consecutive_failures INTEGER DEFAULT 0,
      last_failed_tool TEXT,
      last_failure_reason TEXT,
      current_token_count INTEGER DEFAULT 0,
      compaction_count INTEGER DEFAULT 0,
      started_at TEXT,
      last_activity_at TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `)
  
  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_criteria_session ON criteria(session_id)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)
  `)
  
  // Migration: Add mode, is_running, summary columns if they don't exist
  // And migrate phase to mode
  const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
  const columnNames = columns.map(c => c.name)
  
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
  
  // Create turn_events table for event sourcing
  // Events are the source of truth for assistant turns
  db.exec(`
    CREATE TABLE IF NOT EXISTS turn_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      UNIQUE(session_id, turn_id, seq)
    )
  `)
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_turn_events_session_turn 
    ON turn_events(session_id, turn_id, seq)
  `)
  
  // Migration: Add message_count_at_last_update column to execution_state
  const execStateColumns = db.prepare(`PRAGMA table_info(execution_state)`).all() as { name: string }[]
  const execStateColumnNames = execStateColumns.map(c => c.name)
  
  if (!execStateColumnNames.includes('message_count_at_last_update')) {
    logger.info('Migrating execution_state table: adding message_count_at_last_update column')
    db.exec(`ALTER TABLE execution_state ADD COLUMN message_count_at_last_update INTEGER DEFAULT 0`)
  }
  
  logger.info('Database migrations completed')
}
