/**
 * Session-scoped RTK token savings.
 *
 * RTK (https://github.com/rtk-ai/rtk) records the per-command token savings it
 * produced in its own SQLite history (`commands` table: `timestamp`,
 * `project_path`, `saved_tokens`). OpenFox never sees those numbers directly —
 * it only asks RTK to rewrite commands — so the session total is read back from
 * that history, scoped to the session's working directory and start time.
 *
 * Fail-open by design: a missing database, an unknown schema, or a locked file
 * must never block a turn, so every failure degrades to 0.
 */

import Database from 'better-sqlite3'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../utils/logger.js'

/** Platform directory RTK stores its config and history in. */
function rtkDataDir(): string {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'rtk')
    case 'win32':
      return join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'rtk')
    default:
      return join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), 'rtk')
  }
}

/** Minimal read of RTK's `[tracking].database_path` override, when configured. */
function readConfiguredDbPath(configDir: string): string | null {
  try {
    const configPath = join(configDir, 'config.toml')
    if (!existsSync(configPath)) return null
    const match = /^\s*database_path\s*=\s*"([^"]+)"/m.exec(readFileSync(configPath, 'utf8'))
    return match?.[1] ? match[1] : null
  } catch {
    return null
  }
}

export function getRtkHistoryDbPath(): string {
  const override = process.env['RTK_DB_PATH']
  if (override && override.trim()) return override.trim()
  const dir = rtkDataDir()
  return readConfiguredDbPath(dir) ?? join(dir, 'history.db')
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * Total tokens saved by RTK commands run under `workdir` (or a subdirectory)
 * since `sinceIso`. Returns 0 when RTK's history is unavailable.
 *
 * The connection is opened and closed per call on purpose: a cached read-only
 * handle keeps the file locked on Windows, which blocks temp-dir cleanup and
 * any RTK history reset. The short `busy_timeout` bounds a locked database, and
 * this runs at most once per tool batch.
 */
export function getRtkSessionSavedTokens(workdir: string, sinceIso: string): number {
  if (!workdir || !sinceIso) return 0

  const dbPath = getRtkHistoryDbPath()
  if (!existsSync(dbPath)) return 0

  let db: Database.Database | undefined
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    db.pragma('busy_timeout = 100')
    // RTK records the platform-native path separator, so match both `/` and `\`.
    const escaped = escapeLike(workdir)
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(saved_tokens), 0) AS total
           FROM commands
          WHERE (project_path = ?
             OR project_path LIKE ? ESCAPE '\\'
             OR project_path LIKE ? ESCAPE '\\')
            AND julianday(timestamp) >= julianday(?)`,
      )
      .get(workdir, `${escaped}/%`, `${escaped}\\\\%`, sinceIso) as { total: number } | undefined
    const total = row?.total ?? 0
    return Number.isFinite(total) && total > 0 ? Math.round(total) : 0
  } catch (error) {
    logger.debug('RTK session savings unavailable', {
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  } finally {
    db?.close()
  }
}
