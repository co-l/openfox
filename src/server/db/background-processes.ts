import { getDatabase } from './index.js'

/**
 * Durable record of a background process.
 *
 * The in-memory store (src/server/tools/background-process/store.ts) is wiped
 * on server restart, so it cannot answer "what happened to this process?"
 * after a restart. This table keeps the terminal outcome of every process the
 * server ever started, which lets a wait report an explicit
 * 'unknown'/'interrupted' state instead of pretending the process completed.
 */

export type DurableProcessStatus = 'pending' | 'running' | 'exited' | 'stopped' | 'interrupted'

export interface DurableProcessRecord {
  id: string
  sessionId: string
  name: string
  command: string
  cwd: string
  pid: number | null
  status: DurableProcessStatus
  exitCode: number | null
  signal: string | null
  reason: string | null
  detail: string | null
  startedAt: number | null
  endedAt: number | null
  createdAt: number
}

interface DurableRow {
  id: string
  session_id: string
  name: string
  command: string
  cwd: string
  pid: number | null
  status: string
  exit_code: number | null
  signal: string | null
  reason: string | null
  detail: string | null
  started_at: number | null
  ended_at: number | null
  created_at: number
}

function toRecord(row: DurableRow): DurableProcessRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    command: row.command,
    cwd: row.cwd,
    pid: row.pid,
    status: row.status as DurableProcessStatus,
    exitCode: row.exit_code,
    signal: row.signal,
    reason: row.reason,
    detail: row.detail,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  }
}

/**
 * The database is optional at runtime: unit tests and early bootstrap may run
 * without an initialized database. Every operation degrades to a no-op.
 */
function withDatabase<T>(operation: () => T, fallback: T): T {
  try {
    return operation()
  } catch {
    return fallback
  }
}

export function recordProcessCreated(id: string, sessionId: string, name: string, command: string, cwd: string): void {
  withDatabase(() => {
    getDatabase()
      .prepare(
        `
        INSERT INTO background_processes
          (id, session_id, name, command, cwd, pid, status, exit_code, signal, reason, detail, started_at, ended_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, NULL, ?)
        ON CONFLICT(id) DO UPDATE SET
          session_id = excluded.session_id,
          name = excluded.name,
          command = excluded.command,
          cwd = excluded.cwd
      `,
      )
      .run(id, sessionId, name, command, cwd, Date.now())
  }, undefined)
}

export function recordProcessStarted(id: string, pid: number): void {
  withDatabase(() => {
    getDatabase()
      .prepare(
        `
        UPDATE background_processes
        SET status = 'running', pid = ?, started_at = ?
        WHERE id = ?
      `,
      )
      .run(pid, Date.now(), id)
  }, undefined)
}

export function recordProcessExited(
  id: string,
  exitCode: number | null,
  signal: string | null,
  reason: string,
  detail?: string,
): void {
  withDatabase(() => {
    getDatabase()
      .prepare(
        `
        UPDATE background_processes
        SET status = 'exited', exit_code = ?, signal = ?, reason = ?, detail = ?, ended_at = ?
        WHERE id = ?
      `,
      )
      .run(exitCode, signal, reason, detail ?? null, Date.now(), id)
  }, undefined)
}

export function recordProcessStopped(id: string, reason: string): void {
  withDatabase(() => {
    getDatabase()
      .prepare(
        `
        UPDATE background_processes
        SET status = 'stopped', reason = ?, ended_at = ?
        WHERE id = ?
      `,
      )
      .run(reason, Date.now(), id)
  }, undefined)
}

export function getProcessRecord(id: string): DurableProcessRecord | undefined {
  return withDatabase(() => {
    const row = getDatabase().prepare(`SELECT * FROM background_processes WHERE id = ?`).get(id) as
      DurableRow | undefined
    return row ? toRecord(row) : undefined
  }, undefined)
}

/**
 * Processes still marked as running when the server starts cannot be alive
 * anymore — the previous process tree was killed on shutdown. Mark them
 * 'interrupted' so a later wait reports an explicit unknown state instead of
 * claiming a completion that never happened.
 */
export function markInterruptedProcesses(): number {
  return withDatabase(() => {
    const result = getDatabase()
      .prepare(
        `
        UPDATE background_processes
        SET status = 'interrupted', reason = 'interrupted', ended_at = ?
        WHERE status IN ('running', 'pending')
      `,
      )
      .run(Date.now())
    return result.changes
  }, 0)
}
