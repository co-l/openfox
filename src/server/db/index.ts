import Database from 'better-sqlite3'
import type { Config } from '../config.js'
import { logger } from '../utils/logger.js'

/**
 * Schema format version, stamped into PRAGMA user_version. The v3
 * conversation-tree shape (tree_id/event_id/parent_id events + blobs table)
 * is version 3. It is only ever updated here — at database init/migration.
 */
export const SCHEMA_VERSION = 3

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
  // Note: mode, phase, isRunning are persisted here for quick access
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

  if (!projectColumnNames.includes('danger_level')) {
    logger.info('Migrating projects table: adding danger_level column')
    db.exec(`ALTER TABLE projects ADD COLUMN danger_level TEXT`)
  }

  if (!projectColumnNames.includes('is_starred')) {
    logger.info('Migrating projects table: adding is_starred column')
    db.exec(`ALTER TABLE projects ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0`)
  }

  if (!projectColumnNames.includes('default_agent')) {
    logger.info('Migrating projects table: adding default_agent column')
    db.exec(`ALTER TABLE projects ADD COLUMN default_agent TEXT`)
  }

  if (!projectColumnNames.includes('workspace_root_dir')) {
    logger.info('Migrating projects table: adding workspace_root_dir column')
    db.exec(`ALTER TABLE projects ADD COLUMN workspace_root_dir TEXT`)
  }

  if (!projectColumnNames.includes('mcp_overrides')) {
    logger.info('Migrating projects table: adding mcp_overrides column')
    db.exec(`ALTER TABLE projects ADD COLUMN mcp_overrides TEXT`)
  }

  // Migration: Add mcp_disabled_servers column to sessions table
  if (!columnNames.includes('mcp_disabled_servers')) {
    logger.info('Migrating sessions table: adding mcp_disabled_servers column')
    db.exec(`ALTER TABLE sessions ADD COLUMN mcp_disabled_servers TEXT`)
  }

  // Migration: Add is_favorite column to sessions table
  if (!columnNames.includes('is_favorite')) {
    logger.info('Migrating sessions table: adding is_favorite column')
    db.exec(`ALTER TABLE sessions ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0`)
  }

  // Conversation-tree events table (v3). Events are tree nodes: (tree_id,
  // event_id, parent_id). A session is (tree_id, cursor_event_id) in the
  // sessions table. Trees are shared by forked sessions, so there is no FK to
  // sessions — tree lifetime is managed by the EventStore (dead-branch GC).
  //
  // v3 intentionally does not carry over pre-v3 history: the old linear
  // (session_id, seq) shape is structurally incompatible with the tree shape,
  // so an old-shaped events table is dropped (and recreated) on upgrade.
  const preEventColumns = db.prepare(`PRAGMA table_info(events)`).all() as { name: string }[]
  const preEventsHaveTreeShape = preEventColumns.some((c) => c.name === 'event_id')
  if (preEventColumns.length > 0 && !preEventsHaveTreeShape) {
    logger.warn('Dropping legacy events table (pre-v3 linear schema). Old session history is not carried into v3.')
    db.exec(`DROP TABLE events`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tree_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      parent_id TEXT,
      seq INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      UNIQUE(tree_id, event_id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_tree_seq ON events(tree_id, seq)
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_tree_type ON events(tree_id, event_type)
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_tree_parent ON events(tree_id, parent_id)
  `)

  // Content-addressed blob store for externalized large payloads (tool
  // results, oversized message content). Deduplicated by content hash.
  db.exec(`
    CREATE TABLE IF NOT EXISTS blobs (
      content_hash TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      content TEXT NOT NULL
    )
  `)

  // Pre-v3 soft-delete machinery — structurally incompatible with trees
  // (sibling branches share prefixes; deleted seq ranges are not addressable).
  db.exec(`DROP TABLE IF EXISTS tombstones`)

  // Migration: conversation-tree columns on sessions (tree_id defaults to the
  // session's own id — every session owns its tree; forks reference a shared
  // tree). cursor_event_id is the session's active path endpoint.
  if (!columnNames.includes('tree_id')) {
    logger.info('Migrating sessions table: adding tree_id column')
    db.exec(`ALTER TABLE sessions ADD COLUMN tree_id TEXT`)
  }
  if (!columnNames.includes('cursor_event_id')) {
    logger.info('Migrating sessions table: adding cursor_event_id column')
    db.exec(`ALTER TABLE sessions ADD COLUMN cursor_event_id TEXT`)
  }
  // Backfill: sessions created before the column existed (or after an events
  // table drop) own their own (now empty) tree.
  db.exec(`UPDATE sessions SET tree_id = id WHERE tree_id IS NULL`)

  // Migration: Add per-session provider/model columns
  if (!columnNames.includes('provider_id')) {
    logger.info('Migrating sessions table: adding provider_id column')
    db.exec(`ALTER TABLE sessions ADD COLUMN provider_id TEXT`)
  }

  if (!columnNames.includes('provider_model')) {
    logger.info('Migrating sessions table: adding provider_model column')
    db.exec(`ALTER TABLE sessions ADD COLUMN provider_model TEXT`)
  }

  // Migration: mark whether the session's provider/model was explicitly picked
  // by the user (sticky, suppresses agent overrides). Legacy rows default to 0 —
  // indistinguishable from inherited defaults, reset on the next explicit pick.
  if (!columnNames.includes('provider_manual')) {
    logger.info('Migrating sessions table: adding provider_manual column')
    db.exec(`ALTER TABLE sessions ADD COLUMN provider_manual INTEGER NOT NULL DEFAULT 0`)
  }

  // Migration: whether the manual pick is currently active. Selecting an agent
  // with a model override deactivates it (the agent's override is the label
  // truth); selecting a non-override agent or making a new pick reactivates it.
  if (!columnNames.includes('provider_manual_active')) {
    logger.info('Migrating sessions table: adding provider_manual_active column')
    db.exec(`ALTER TABLE sessions ADD COLUMN provider_manual_active INTEGER NOT NULL DEFAULT 1`)
  }

  // Migration: per-session reasoning effort override (picked alongside the model)
  if (!columnNames.includes('provider_reasoning_effort')) {
    logger.info('Migrating sessions table: adding provider_reasoning_effort column')
    db.exec(`ALTER TABLE sessions ADD COLUMN provider_reasoning_effort TEXT`)
  }

  // Migration: per-session pinned reasoning effort ("Keep current" on an agent /
  // workflow switch — overrides agent override efforts without replacing model).
  if (!columnNames.includes('provider_pinned_effort')) {
    logger.info('Migrating sessions table: adding provider_pinned_effort column')
    db.exec(`ALTER TABLE sessions ADD COLUMN provider_pinned_effort TEXT`)
  }

  // Migration: Add message_count column for efficient sidebar message counts.
  // Maintained by the EventStore (count of `message` nodes on the session's
  // active path); no backfill — pre-v3 history is not carried over.
  if (!columnNames.includes('message_count')) {
    logger.info('Migrating sessions table: adding message_count column')
    db.exec(`ALTER TABLE sessions ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0`)
  }

  // Migration: Add cached prompt columns for persistent prefix cache across restarts
  if (!columnNames.includes('cached_system_prompt')) {
    logger.info('Migrating sessions table: adding cached_system_prompt column')
    db.exec(`ALTER TABLE sessions ADD COLUMN cached_system_prompt TEXT`)
  }

  if (!columnNames.includes('cached_tools')) {
    logger.info('Migrating sessions table: adding cached_tools column')
    db.exec(`ALTER TABLE sessions ADD COLUMN cached_tools TEXT`)
  }

  if (!columnNames.includes('cached_hash')) {
    logger.info('Migrating sessions table: adding cached_hash column')
    db.exec(`ALTER TABLE sessions ADD COLUMN cached_hash TEXT`)
  }

  if (!columnNames.includes('cached_prompt_hash')) {
    logger.info('Migrating sessions table: adding cached_prompt_hash column')
    db.exec(`ALTER TABLE sessions ADD COLUMN cached_prompt_hash TEXT`)
  }

  // Migration: Rename worktree → workspace
  if (!columnNames.includes('workspace') && columnNames.includes('worktree')) {
    logger.info('Migrating sessions table: renaming worktree to workspace')
    db.exec(`ALTER TABLE sessions RENAME COLUMN worktree TO workspace`)
    // columnNames is a snapshot taken before any migration ran. Without this
    // update the check below still sees the pre-rename state and tries to add
    // a column that now exists, failing with "duplicate column name: workspace".
    columnNames[columnNames.indexOf('worktree')] = 'workspace'
  } else if (!columnNames.includes('workspace')) {
    logger.info('Migrating sessions table: adding workspace column')
    db.exec(`ALTER TABLE sessions ADD COLUMN workspace TEXT`)
  }

  // Migration: Add branch column for session→branch binding
  if (!columnNames.includes('branch')) {
    logger.info('Migrating sessions table: adding branch column')
    db.exec(`ALTER TABLE sessions ADD COLUMN branch TEXT`)
  }

  // Create workflow_executions table for first-class workflow state management
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_executions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      workflow_color TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      current_step_id TEXT,
      current_step_name TEXT,
      step_output TEXT,
      params TEXT,
      pending_choices TEXT,
      sub_group TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_workflow_executions_session
    ON workflow_executions(session_id)
  `)

  // Migration: Add pending_choices column (available branches at a paused user step)
  const workflowExecColumns = db.prepare(`PRAGMA table_info(workflow_executions)`).all() as { name: string }[]
  const workflowExecColumnNames = workflowExecColumns.map((c) => c.name)
  if (!workflowExecColumnNames.includes('pending_choices')) {
    logger.info('Migrating workflow_executions table: adding pending_choices column')
    db.exec(`ALTER TABLE workflow_executions ADD COLUMN pending_choices TEXT`)
  }

  // Migration: Add sub_group column (the sub-group slice a slice run belongs to)
  if (!workflowExecColumnNames.includes('sub_group')) {
    logger.info('Migrating workflow_executions table: adding sub_group column')
    db.exec(`ALTER TABLE workflow_executions ADD COLUMN sub_group TEXT`)
  }

  // ------------------------------------------------------------------
  // Project tasks (kanban board) tables
  // ------------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      attachments TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'todo',
      run_state TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 0,
      agent_id TEXT,
      provider_id TEXT,
      model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, status)`)

  // Migration: scheduled/planned tasks — `schedule` holds the JSON rule,
  // `next_run_at` is the denormalized trigger time the scheduler queries.
  const taskColumns = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]
  const taskColumnNames = taskColumns.map((c) => c.name)
  if (!taskColumnNames.includes('schedule')) {
    logger.info('Migrating tasks table: adding schedule column')
    db.exec(`ALTER TABLE tasks ADD COLUMN schedule TEXT`)
  }
  if (!taskColumnNames.includes('next_run_at')) {
    logger.info('Migrating tasks table: adding next_run_at column')
    db.exec(`ALTER TABLE tasks ADD COLUMN next_run_at TEXT`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_links (
      task_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (task_id, session_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_links_session ON task_links(session_id)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_gates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      required INTEGER NOT NULL DEFAULT 1,
      variant TEXT NOT NULL DEFAULT 'done',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_gates_project ON task_gates(project_id)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_gate_values (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      gate_id TEXT NOT NULL,
      value TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_name TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_gate_values_task ON task_gate_values(task_id)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_audit (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_name TEXT,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_audit_task ON task_audit(task_id)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_task_settings (
      project_id TEXT PRIMARY KEY,
      slot_limit INTEGER NOT NULL DEFAULT 1,
      queue_paused INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `)

  // Stamp the schema format version last — it reflects the full post-migration
  // shape. Upgrades forward (old DBs have user_version 0); a DB stamped with a
  // NEWER version is never downgraded — it is left untouched so the mismatch
  // is visible (and logged) instead of silently rewritten.
  const currentVersion = (db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version
  if (currentVersion < SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  } else if (currentVersion > SCHEMA_VERSION) {
    logger.warn(`Database schema version ${currentVersion} is newer than the supported version ${SCHEMA_VERSION}`)
  }

  logger.info('Database migrations completed')
}
