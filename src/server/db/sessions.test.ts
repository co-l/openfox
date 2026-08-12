/**
 * Session Database Tests
 *
 * Tests session metadata CRUD operations. Message, criteria, and context
 * data is now stored in the events table (tested in events/store.test.ts).
 */

import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from './index.js'
import { createProject, updateProject } from './projects.js'
import { SETTINGS_KEYS, deleteSetting, setSetting } from './settings.js'
import { resolveDefaultAgentId } from '../agents/registry.js'
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  listSessionsByProject,
  listHomeSessions,
  listSessionsLimited,
  toggleFavorite,
  updateSessionMcpDisabledServers,
  updateSessionMetadata,
  updateSessionMode,
  updateSessionPhase,
  updateSessionRunning,
  updateSessionMessageCount,
} from './sessions.js'
import { getDatabase } from './index.js'

describe('db sessions', () => {
  let rootA: string
  let rootB: string
  let projectAId: string
  let projectBId: string

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)

    rootA = await mkdtemp(join(tmpdir(), 'openfox-session-a-'))
    rootB = await mkdtemp(join(tmpdir(), 'openfox-session-b-'))
    await mkdir(join(rootA, 'nested'), { recursive: true })

    projectAId = createProject('Project A', rootA).id
    projectBId = createProject('Project B', rootB).id
  })

  afterEach(async () => {
    closeDatabase()
    await rm(rootA, { recursive: true, force: true })
    await rm(rootB, { recursive: true, force: true })
  })

  it('creates sessions with default values', () => {
    const session = createSession(projectAId, rootA, 'Test Session')

    expect(session).toMatchObject({
      projectId: projectAId,
      workdir: rootA,
      mode: 'planner',
      phase: 'plan',
      isRunning: false,
      messages: [],
      criteria: [],
      contextWindows: [],
      executionState: null,
      metadata: {
        title: 'Test Session',
        totalTokensUsed: 0,
        totalToolCalls: 0,
        iterationCount: 0,
      },
      dangerLevel: 'normal',
    })
    expect(session.id).toBeDefined()
    expect(session.createdAt).toBeDefined()
    expect(session.updatedAt).toBeDefined()
  })

  it('creates sessions using project danger_level as default', () => {
    updateProject(projectAId, { dangerLevel: 'dangerous' })

    const session = createSession(projectAId, rootA, 'Dangerous Session')
    expect(session.dangerLevel).toBe('dangerous')
  })

  it('creates sessions using project default agent', () => {
    updateProject(projectAId, { defaultAgent: 'builder' })

    const session = createSession(projectAId, rootA, 'Builder Session')
    expect(session.mode).toBe('builder')
  })

  it('falls back to global default agent when project has none', () => {
    setSetting(SETTINGS_KEYS.DEFAULT_AGENT, 'architect')

    const session = createSession(projectAId, rootA, 'Global Session')
    expect(session.mode).toBe('architect')

    deleteSetting(SETTINGS_KEYS.DEFAULT_AGENT)
  })

  describe('resolveDefaultAgentId', () => {
    it('prefers project default over global DB setting', () => {
      setSetting(SETTINGS_KEYS.DEFAULT_AGENT, 'architect')
      updateProject(projectAId, { defaultAgent: 'builder' })

      expect(resolveDefaultAgentId(projectAId)).toBe('builder')

      deleteSetting(SETTINGS_KEYS.DEFAULT_AGENT)
    })

    it('falls back to global DB setting when project has no default', () => {
      setSetting(SETTINGS_KEYS.DEFAULT_AGENT, 'architect')

      expect(resolveDefaultAgentId(projectAId)).toBe('architect')

      deleteSetting(SETTINGS_KEYS.DEFAULT_AGENT)
    })

    it('falls back to planner when neither project nor global default is set', () => {
      expect(resolveDefaultAgentId(projectAId)).toBe('planner')
      expect(resolveDefaultAgentId()).toBe('planner')
    })

    it('ignores an empty-string project default and falls back', () => {
      setSetting(SETTINGS_KEYS.DEFAULT_AGENT, 'architect')
      updateProject(projectAId, { defaultAgent: '' })

      expect(resolveDefaultAgentId(projectAId)).toBe('architect')

      deleteSetting(SETTINGS_KEYS.DEFAULT_AGENT)
    })
  })

  it('gets session by id', () => {
    const session = createSession(projectAId, rootA, 'Session A')

    const retrieved = getSession(session.id)
    expect(retrieved).toMatchObject({
      id: session.id,
      projectId: projectAId,
      workdir: rootA,
      phase: 'plan',
      mode: 'planner',
      isRunning: false,
      metadata: {
        title: 'Session A',
        totalTokensUsed: 0,
        totalToolCalls: 0,
        iterationCount: 0,
      },
    })

    expect(getSession('non-existent')).toBeNull()
  })

  it('updates session mode', () => {
    const session = createSession(projectAId, rootA)

    updateSessionMode(session.id, 'builder')
    expect(getSession(session.id)?.mode).toBe('builder')

    updateSessionMode(session.id, 'planner')
    expect(getSession(session.id)?.mode).toBe('planner')
  })

  it('updates session phase', () => {
    const session = createSession(projectAId, rootA)

    updateSessionPhase(session.id, 'build')
    expect(getSession(session.id)?.phase).toBe('build')

    updateSessionPhase(session.id, 'verification')
    expect(getSession(session.id)?.phase).toBe('verification')
  })

  it('updates session running state', () => {
    const session = createSession(projectAId, rootA)

    updateSessionRunning(session.id, true)
    expect(getSession(session.id)?.isRunning).toBe(true)

    updateSessionRunning(session.id, false)
    expect(getSession(session.id)?.isRunning).toBe(false)
  })

  it('updates session metadata', () => {
    const session = createSession(projectAId, rootA)

    updateSessionMetadata(session.id, {
      title: 'Updated Title',
      totalTokensUsed: 1000,
      totalToolCalls: 50,
      iterationCount: 5,
    })

    const retrieved = getSession(session.id)
    expect(retrieved?.metadata).toMatchObject({
      title: 'Updated Title',
      totalTokensUsed: 1000,
      totalToolCalls: 50,
      iterationCount: 5,
    })
  })

  it('lists all sessions', () => {
    createSession(projectAId, rootA, 'Session A')
    createSession(projectBId, rootB, 'Session B')

    const sessions = listSessions()
    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.title)).toContain('Session A')
    expect(sessions.map((s) => s.title)).toContain('Session B')
  })

  it('lists sessions by project using project_id only', () => {
    const sessionA = createSession(projectAId, rootA, 'Session A')
    const sessionANested = createSession(projectAId, join(rootA, 'nested'), 'Nested Session A')
    const sessionB = createSession(projectBId, rootB, 'Session B')
    // This session belongs to projectB but has a workdir nested under projectA
    // It should NOT appear when listing sessions for projectA
    createSession(projectBId, join(rootA, 'nested'), 'Nested Session B')

    const filtered = listSessionsByProject(projectAId)
    expect(filtered.sessions.map((s) => s.id)).toContain(sessionA.id)
    expect(filtered.sessions.map((s) => s.id)).toContain(sessionANested.id)
    expect(filtered.sessions.map((s) => s.id)).not.toContain(sessionB.id)
    expect(filtered.sessions).toHaveLength(2)
  })

  it('deletes sessions', () => {
    const session = createSession(projectAId, rootA)

    expect(getSession(session.id)).not.toBeNull()

    deleteSession(session.id)

    expect(getSession(session.id)).toBeNull()
  })

  it('handles sessions without title', () => {
    const session = createSession(projectAId, rootA)

    expect(session.metadata.title).toBeUndefined()

    const retrieved = getSession(session.id)
    expect(retrieved?.metadata.title).toBeUndefined()
  })

  it('prevents session leakage between projects with similar names', () => {
    // Simulate the bug scenario: projects with similar names (e.g., "openfox" and "openfox-agent2")
    // Create sessions in both projects
    const sessionA1 = createSession(projectAId, rootA, 'Session A1')
    const sessionA2 = createSession(projectAId, rootA, 'Session A2')
    const sessionB1 = createSession(projectBId, rootB, 'Session B1')
    const sessionB2 = createSession(projectBId, rootB, 'Session B2')

    // List sessions for project A - should only return A sessions
    const projectASessions = listSessionsByProject(projectAId)
    expect(projectASessions.sessions).toHaveLength(2)
    expect(projectASessions.sessions.map((s) => s.id)).toContain(sessionA1.id)
    expect(projectASessions.sessions.map((s) => s.id)).toContain(sessionA2.id)
    expect(projectASessions.sessions.map((s) => s.id)).not.toContain(sessionB1.id)
    expect(projectASessions.sessions.map((s) => s.id)).not.toContain(sessionB2.id)

    // List sessions for project B - should only return B sessions
    const projectBSessions = listSessionsByProject(projectBId)
    expect(projectBSessions.sessions).toHaveLength(2)
    expect(projectBSessions.sessions.map((s) => s.id)).toContain(sessionB1.id)
    expect(projectBSessions.sessions.map((s) => s.id)).toContain(sessionB2.id)
    expect(projectBSessions.sessions.map((s) => s.id)).not.toContain(sessionA1.id)
    expect(projectBSessions.sessions.map((s) => s.id)).not.toContain(sessionA2.id)

    // Verify all sessions exist in the global list
    const allSessions = listSessions()
    expect(allSessions).toHaveLength(4)
  })

  it('includes messageCount in session summaries', () => {
    const sessionA = createSession(projectAId, rootA, 'Session A')
    const sessionB = createSession(projectBId, rootB, 'Session B')

    const allSessions = listSessions()
    expect(allSessions).toHaveLength(2)

    const sessionASummary = allSessions.find((s) => s.id === sessionA.id)
    const sessionBSummary = allSessions.find((s) => s.id === sessionB.id)

    expect(sessionASummary).toBeDefined()
    expect(sessionASummary?.messageCount).toBe(0)
    expect(sessionBSummary).toBeDefined()
    expect(sessionBSummary?.messageCount).toBe(0)
  })

  it('counts messages correctly in session summaries', () => {
    const session = createSession(projectAId, rootA, 'Test Session')

    // Simulate emitting user and assistant messages by incrementing the counter
    // (tool messages are not counted - they use a different code path)
    updateSessionMessageCount(session.id, 1) // user message
    updateSessionMessageCount(session.id, 1) // assistant message

    const sessions = listSessionsByProject(projectAId)
    const sessionSummary = sessions.sessions.find((s) => s.id === session.id)

    expect(sessionSummary).toBeDefined()
    expect(sessionSummary?.messageCount).toBe(2) // Only user and assistant messages
  })

  it('updateSessionMcpDisabledServers does not modify updated_at', async () => {
    const session = createSession(projectAId, rootA, 'MCP Test')

    // Delay to ensure the timestamp would differ if updated_at were touched
    await new Promise((r) => setTimeout(r, 5))

    const beforeUpdate = getSession(session.id)!
    const originalUpdatedAt = beforeUpdate.updatedAt

    updateSessionMcpDisabledServers(session.id, ['server-1', 'server-2'])

    const afterUpdate = getSession(session.id)!
    expect(afterUpdate.updatedAt).toBe(originalUpdatedAt)
  })

  it('updateSessionMcpDisabledServers sets mcp_disabled_servers to JSON array when servers are provided', () => {
    const session = createSession(projectAId, rootA, 'MCP JSON Test')

    updateSessionMcpDisabledServers(session.id, ['mcp-a', 'mcp-b'])

    const db = getDatabase()
    const row = db.prepare('SELECT mcp_disabled_servers FROM sessions WHERE id = ?').get(session.id) as {
      mcp_disabled_servers: string | null
    }
    expect(row).not.toBeNull()
    expect(row.mcp_disabled_servers).toBe(JSON.stringify(['mcp-a', 'mcp-b']))
  })

  it('updateSessionMcpDisabledServers sets mcp_disabled_servers to null when list is empty', () => {
    const session = createSession(projectAId, rootA, 'MCP Empty Test')

    // First set some servers
    updateSessionMcpDisabledServers(session.id, ['server-1'])
    // Then clear with empty array
    updateSessionMcpDisabledServers(session.id, [])

    const db = getDatabase()
    const row = db.prepare('SELECT mcp_disabled_servers FROM sessions WHERE id = ?').get(session.id) as {
      mcp_disabled_servers: string | null
    }
    expect(row.mcp_disabled_servers).toBeNull()
  })

  it('toggles favorite on and off', () => {
    const session = createSession(projectAId, rootA, 'Favorite Test')

    // Default should be not favorite
    const rowBefore = getDatabase().prepare('SELECT is_favorite FROM sessions WHERE id = ?').get(session.id) as {
      is_favorite: number
    }
    expect(rowBefore.is_favorite).toBe(0)

    // Toggle on
    toggleFavorite(session.id, true)
    const rowOn = getDatabase().prepare('SELECT is_favorite FROM sessions WHERE id = ?').get(session.id) as {
      is_favorite: number
    }
    expect(rowOn.is_favorite).toBe(1)

    // Toggle off
    toggleFavorite(session.id, false)
    const rowOff = getDatabase().prepare('SELECT is_favorite FROM sessions WHERE id = ?').get(session.id) as {
      is_favorite: number
    }
    expect(rowOff.is_favorite).toBe(0)
  })

  it('includes isFavorite in session summaries', () => {
    const sessionFav = createSession(projectAId, rootA, 'Fav Session')
    const sessionNormal = createSession(projectAId, rootA, 'Normal Session')

    toggleFavorite(sessionFav.id, true)

    const sessions = listSessions()
    const fav = sessions.find((s) => s.id === sessionFav.id)
    const normal = sessions.find((s) => s.id === sessionNormal.id)

    expect(fav?.isFavorite).toBe(true)
    expect(normal?.isFavorite).toBe(false)
  })

  it('sorts favorite sessions before non-favorites in listSessions', () => {
    const sessionFav = createSession(projectAId, rootA, 'Fav Session')
    const sessionNormal = createSession(projectAId, rootA, 'Normal Session')

    toggleFavorite(sessionFav.id, true)

    const sessions = listSessions()
    const favIndex = sessions.findIndex((s) => s.id === sessionFav.id)
    const normalIndex = sessions.findIndex((s) => s.id === sessionNormal.id)

    expect(favIndex).toBeLessThan(normalIndex)
  })

  it('sorts favorite sessions before non-favorites in listSessionsByProject', () => {
    const sessionFav = createSession(projectAId, rootA, 'Fav Session')
    const sessionNormal = createSession(projectAId, rootA, 'Normal Session')

    toggleFavorite(sessionFav.id, true)

    const { sessions } = listSessionsByProject(projectAId)
    const favIndex = sessions.findIndex((s) => s.id === sessionFav.id)
    const normalIndex = sessions.findIndex((s) => s.id === sessionNormal.id)

    expect(favIndex).toBeLessThan(normalIndex)
  })

  describe('listHomeSessions', () => {
    function setUpdatedAt(id: string, iso: string): void {
      getDatabase().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(iso, id)
    }

    it('returns at most N most recent sessions per project, ordered by last activity', () => {
      const a1 = createSession(projectAId, rootA, 'A1')
      const a2 = createSession(projectAId, rootA, 'A2')
      const a3 = createSession(projectAId, rootA, 'A3')
      const bs = Array.from({ length: 7 }, (_, i) => createSession(projectBId, rootB, `B${i + 1}`))

      setUpdatedAt(a1.id, '2024-01-01T00:00:00.000Z')
      setUpdatedAt(a2.id, '2024-01-01T00:00:01.000Z')
      setUpdatedAt(a3.id, '2024-01-01T00:00:02.000Z')
      bs.forEach((s, i) => setUpdatedAt(s.id, `2024-01-01T00:00:${String(i + 3).padStart(2, '0')}.000Z`))

      const home = listHomeSessions()

      const aIds = home.filter((s) => s.projectId === projectAId).map((s) => s.id)
      const bIds = home.filter((s) => s.projectId === projectBId).map((s) => s.id)
      expect(aIds).toEqual([a3.id, a2.id, a1.id]) // 3 sessions ≤ 5, all included, newest first
      expect(bIds).toEqual(
        bs
          .slice(2)
          .reverse()
          .map((s) => s.id),
      ) // B7, B6, B5, B4, B3
      expect(home).toHaveLength(8)
    })

    it('excludes projects with no sessions and returns summaries only', () => {
      const session = createSession(projectAId, rootA, 'Only')

      const home = listHomeSessions()

      expect(home).toHaveLength(1)
      expect(home[0]!.id).toBe(session.id)
      expect(home[0]).not.toHaveProperty('recentUserPrompts')
    })

    it('supports a custom per-project limit', () => {
      createSession(projectAId, rootA, 'A1')
      createSession(projectAId, rootA, 'A2')
      createSession(projectBId, rootB, 'B1')

      expect(listHomeSessions(1)).toHaveLength(2)
    })
  })

  describe('listSessionsLimited', () => {
    function setUpdatedAt(id: string, iso: string): void {
      getDatabase().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(iso, id)
    }

    it('returns the top-N most recent sessions across all projects with hasMore', () => {
      const a = createSession(projectAId, rootA, 'A')
      const b1 = createSession(projectBId, rootB, 'B1')
      const b2 = createSession(projectBId, rootB, 'B2')
      const b3 = createSession(projectBId, rootB, 'B3')

      setUpdatedAt(a.id, '2024-01-01T00:00:03.000Z') // most recent
      setUpdatedAt(b1.id, '2024-01-01T00:00:02.000Z')
      setUpdatedAt(b2.id, '2024-01-01T00:00:01.000Z')
      setUpdatedAt(b3.id, '2024-01-01T00:00:00.000Z')

      const page = listSessionsLimited(2, 0)

      expect(page.sessions.map((s) => s.id)).toEqual([a.id, b1.id])
      expect(page.hasMore).toBe(true)

      const page2 = listSessionsLimited(2, 2)
      expect(page2.sessions.map((s) => s.id)).toEqual([b2.id, b3.id])
      expect(page2.hasMore).toBe(false)
    })
  })
})
