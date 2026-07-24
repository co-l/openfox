import { getDatabase } from '../db/index.js'
import { updateSessionMcpDisabledServers } from '../db/sessions.js'

const sessionOverrides = new Map<string, Set<string>>()
let initialized = false

function ensureInitialized(): void {
  if (initialized) return
  initialized = true
  try {
    const db = getDatabase()
    const rows = db
      .prepare(
        `SELECT id, mcp_disabled_servers FROM sessions WHERE mcp_disabled_servers IS NOT NULL AND mcp_disabled_servers != ''`,
      )
      .all() as { id: string; mcp_disabled_servers: string }[]
    for (const row of rows) {
      try {
        const servers = JSON.parse(row.mcp_disabled_servers) as string[]
        if (Array.isArray(servers) && servers.length > 0) {
          sessionOverrides.set(row.id, new Set(servers))
        }
      } catch {
        // ignore parse errors
      }
    }
  } catch {
    // DB might not be ready yet
  }
}

export function getSessionDisabledServers(sessionId: string): string[] {
  ensureInitialized()
  return Array.from(sessionOverrides.get(sessionId) ?? [])
}

export function setSessionDisabledServers(sessionId: string, servers: string[]): void {
  ensureInitialized()
  if (servers.length === 0) {
    sessionOverrides.delete(sessionId)
  } else {
    sessionOverrides.set(sessionId, new Set(servers))
  }
  try {
    updateSessionMcpDisabledServers(sessionId, servers)
  } catch {
    // Non-critical — in-memory state still correct
  }
}

export function clearSessionOverrides(sessionId: string): void {
  sessionOverrides.delete(sessionId)
  try {
    updateSessionMcpDisabledServers(sessionId, [])
  } catch {
    // ignore
  }
}

export function getAllSessionOverrides(): Map<string, Set<string>> {
  ensureInitialized()
  return sessionOverrides
}
