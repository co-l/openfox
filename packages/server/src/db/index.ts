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
  
  // Create sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workdir TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title TEXT,
      total_tokens_used INTEGER DEFAULT 0,
      total_tool_calls INTEGER DEFAULT 0,
      iteration_count INTEGER DEFAULT 0
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
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `)
  
  // Create criteria table
  db.exec(`
    CREATE TABLE IF NOT EXISTS criteria (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      description TEXT NOT NULL,
      verification TEXT NOT NULL,
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
  
  logger.info('Database migrations completed')
}
