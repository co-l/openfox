import { getDatabase } from '../db/index.js'
import { updateSessionMcpDisabledServers } from '../db/sessions.js'
import { getProject } from '../db/projects.js'

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

export type GlobalMcpServersProvider = () => Array<{ name: string; disabled?: boolean | undefined }>

let globalMcpServersProvider: GlobalMcpServersProvider | null = null

export function setGlobalMcpServersProvider(provider: GlobalMcpServersProvider | null): void {
  globalMcpServersProvider = provider
}

export function computeDisabledServersForProject(
  projectOverrides?: Record<string, { disabled?: boolean; disabledTools?: string[] }> | null,
  globalServers?: Array<{ name: string; disabled?: boolean }>,
): string[] {
  const servers = globalServers ?? globalMcpServersProvider?.() ?? []
  const disabledSet = new Set<string>()

  // 1. Process known global servers with project overrides or fallback to global disabled
  for (const server of servers) {
    const override = projectOverrides?.[server.name]
    const isDisabled = override?.disabled !== undefined ? override.disabled : !!server.disabled
    if (isDisabled) {
      disabledSet.add(server.name)
    }
  }

  // 2. Also process any project overrides for servers not present in globalServers
  if (projectOverrides) {
    for (const [name, override] of Object.entries(projectOverrides)) {
      if (override.disabled) {
        disabledSet.add(name)
      }
    }
  }

  return Array.from(disabledSet)
}

export function initSessionMcpOverrides(
  sessionId: string,
  projectId: string,
  projectOverrides?: Record<string, { disabled?: boolean; disabledTools?: string[] }> | null,
): void {
  try {
    const project = projectOverrides !== undefined ? { mcpOverrides: projectOverrides } : getProject(projectId)
    const disabledServers = computeDisabledServersForProject(project?.mcpOverrides)
    if (disabledServers.length > 0) {
      setSessionDisabledServers(sessionId, disabledServers)
    }
  } catch {
    // Non-critical — session works without MCP overrides
  }
}
