/**
 * Session Database Operations
 *
 * Manages session metadata in SQLite. Session content (messages, criteria, todos)
 * is stored in the events table and derived via EventStore folding.
 */

import type {
  Session,
  SessionSummary,
  SessionMode,
  SessionPhase,
} from '../../shared/types.js'
import { getDatabase } from './index.js'

export type DangerLevel = 'normal' | 'dangerous'

// ============================================================================
// Session Operations
// ============================================================================

export function createSession(projectId: string, workdir: string, title?: string, providerId?: string | null, providerModel?: string | null): Session {
  const db = getDatabase()
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  db.prepare(`
    INSERT INTO sessions (id, project_id, workdir, phase, mode, workflow_phase, is_running, created_at, updated_at, title, provider_id, provider_model, danger_level)
    VALUES (?, ?, ?, 'idle', 'planner', 'plan', 0, ?, ?, ?, ?, ?, 'normal')
  `).run(id, projectId, workdir, now, now, title ?? null, providerId ?? null, providerModel ?? null)

  return {
    id,
    projectId,
    workdir,
    mode: 'planner',
    phase: 'plan',
    isRunning: false,
    summary: null,
    providerId: providerId ?? null,
    providerModel: providerModel ?? null,
    createdAt: now,
    updatedAt: now,
    messages: [],
    criteria: [],
    contextWindows: [],
    executionState: null,
    metadata: {
      ...(title ? { title } : {}),
      totalTokensUsed: 0,
      totalToolCalls: 0,
      iterationCount: 0,
    },
    dangerLevel: 'normal',
  }
}

export function getSession(id: string): Session | null {
  const db = getDatabase()
  
  const row = db.prepare(`
    SELECT * FROM sessions WHERE id = ?
  `).get(id) as SessionRow | undefined
  
  if (!row) {
    return null
  }
  
  // Note: messages, criteria, contextWindows, executionState are derived from EventStore
  // This function returns the DB row data only - caller should enrich with event data
  return {
    id: row.id,
    projectId: row.project_id,
    workdir: row.workdir,
    mode: (row.mode ?? 'planner') as SessionMode,
    phase: (row.workflow_phase ?? 'plan') as SessionPhase,
    isRunning: Boolean(row.is_running),
    summary: row.summary ?? null,
    providerId: row.provider_id ?? null,
    providerModel: row.provider_model ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: [],
    criteria: [],
    contextWindows: [],
    executionState: null,
    metadata: {
      ...(row.title ? { title: row.title } : {}),
      totalTokensUsed: row.total_tokens_used,
      totalToolCalls: row.total_tool_calls,
      iterationCount: row.iteration_count,
    },
    dangerLevel: (row.danger_level ?? 'normal') as DangerLevel,
  }
}

export function updateSessionProvider(id: string, providerId: string | null, providerModel: string | null): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  db.prepare(`
    UPDATE sessions SET provider_id = ?, provider_model = ?, updated_at = ? WHERE id = ?
  `).run(providerId, providerModel, now, id)
}

export function updateSessionMode(id: string, mode: SessionMode): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  db.prepare(`
    UPDATE sessions SET mode = ?, updated_at = ? WHERE id = ?
  `).run(mode, now, id)
}

export function updateSessionDangerLevel(id: string, dangerLevel: DangerLevel): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  db.prepare(`
    UPDATE sessions SET danger_level = ?, updated_at = ? WHERE id = ?
  `).run(dangerLevel, now, id)
}

export function updateSessionPhase(id: string, phase: SessionPhase): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  db.prepare(`
    UPDATE sessions SET workflow_phase = ?, updated_at = ? WHERE id = ?
  `).run(phase, now, id)
}

export function updateSessionRunning(id: string, isRunning: boolean): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  db.prepare(`
    UPDATE sessions SET is_running = ?, updated_at = ? WHERE id = ?
  `).run(isRunning ? 1 : 0, now, id)
}

export function updateSessionSummary(id: string, summary: string): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  db.prepare(`
    UPDATE sessions SET summary = ?, updated_at = ? WHERE id = ?
  `).run(summary, now, id)
}

export function updateSessionMetadata(
  id: string,
  metadata: Partial<Session['metadata']>
): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  const updates: string[] = ['updated_at = ?']
  const values: (string | number)[] = [now]
  
  if (metadata.title !== undefined) {
    updates.push('title = ?')
    values.push(metadata.title ?? '')
  }
  if (metadata.totalTokensUsed !== undefined) {
    updates.push('total_tokens_used = ?')
    values.push(metadata.totalTokensUsed)
  }
  if (metadata.totalToolCalls !== undefined) {
    updates.push('total_tool_calls = ?')
    values.push(metadata.totalToolCalls)
  }
  if (metadata.iterationCount !== undefined) {
    updates.push('iteration_count = ?')
    values.push(metadata.iterationCount)
  }
  
  values.push(id)
  
  db.prepare(`
    UPDATE sessions SET ${updates.join(', ')} WHERE id = ?
  `).run(...values)
}

export function listSessions(): SessionSummary[] {
  const db = getDatabase()
  
  const rows = db.prepare(`
    SELECT
      s.id,
      s.project_id,
      s.workdir,
      s.mode,
      s.workflow_phase,
      s.is_running,
      s.created_at,
      s.updated_at,
      s.title,
      s.provider_id,
      s.provider_model,
      COALESCE(
        (SELECT COUNT(*) FROM events e 
         WHERE e.session_id = s.id 
         AND e.event_type = 'message.start'
         AND json_extract(e.payload, '$.role') IN ('user', 'assistant'))
        +
        COALESCE(
          (SELECT SUM(json_array_length(json_extract(e.payload, '$.messages'))) FROM events e
           WHERE e.session_id = s.id
           AND e.event_type = 'turn.snapshot'
           AND json_extract(e.payload, '$.messages') IS NOT NULL),
          0
        ),
        0
      ) as message_count
    FROM sessions s
    ORDER BY s.updated_at DESC
  `).all() as SessionSummaryRow[]

  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    ...(row.title ? { title: row.title } : {}),
    workdir: row.workdir,
    mode: (row.mode ?? 'planner') as SessionMode,
    phase: (row.workflow_phase ?? 'plan') as SessionPhase,
    isRunning: Boolean(row.is_running),
    providerId: row.provider_id ?? null,
    providerModel: row.provider_model ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    criteriaCount: 0, // Derived from events
    criteriaCompleted: 0, // Derived from events
    messageCount: row.message_count,
  }))
}

export function listSessionsByProject(projectId: string, limit = 20, offset = 0): { sessions: SessionSummary[]; hasMore: boolean } {
  const db = getDatabase()

  const rows = db.prepare(`
    SELECT
      s.id,
      s.project_id,
      s.workdir,
      s.mode,
      s.workflow_phase,
      s.is_running,
      s.created_at,
      s.updated_at,
      s.title,
      s.provider_id,
      s.provider_model,
      COALESCE(
        (SELECT COUNT(*) FROM events e 
         WHERE e.session_id = s.id 
         AND e.event_type = 'message.start'
         AND json_extract(e.payload, '$.role') IN ('user', 'assistant'))
        +
        COALESCE(
          (SELECT SUM(json_array_length(json_extract(e.payload, '$.messages'))) FROM events e
           WHERE e.session_id = s.id
           AND e.event_type = 'turn.snapshot'
           AND json_extract(e.payload, '$.messages') IS NOT NULL),
          0
        ),
        0
      ) as message_count
    FROM sessions s
    WHERE s.project_id = ?
    ORDER BY s.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(projectId, limit + 1, offset) as SessionSummaryRow[]

  const hasMore = rows.length > limit
  const sessions = rows.slice(0, limit).map(row => ({
    id: row.id,
    projectId: row.project_id,
    ...(row.title ? { title: row.title } : {}),
    workdir: row.workdir,
    mode: (row.mode ?? 'planner') as SessionMode,
    phase: (row.workflow_phase ?? 'plan') as SessionPhase,
    isRunning: Boolean(row.is_running),
    providerId: row.provider_id ?? null,
    providerModel: row.provider_model ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: row.message_count,
  }))

  return { sessions, hasMore }
}

export function deleteSession(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

// ============================================================================
// Row Types
// ============================================================================

interface SessionRow {
  id: string
  project_id: string
  workdir: string
  phase: string
  mode: string
  workflow_phase: string
  is_running: number
  summary: string | null
  provider_id: string | null
  provider_model: string | null
  created_at: string
  updated_at: string
  title: string | null
  total_tokens_used: number
  total_tool_calls: number
  iteration_count: number
  danger_level: string
}

interface SessionSummaryRow {
  id: string
  project_id: string
  workdir: string
  mode: string
  workflow_phase: string
  is_running: number
  created_at: string
  updated_at: string
  title: string | null
  provider_id: string | null
  provider_model: string | null
  message_count: number
}