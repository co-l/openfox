import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createWorkspaceConfigRoutes } from './workspace-config.js'
import Database from 'better-sqlite3'

/**
 * Simulates project DB records for route tests.
 * Maps workdir → project data. Auto-creates entries on first access.
 * updateProject uses a reverse lookup (id → workdir) to find the right record.
 */
const mockProjectById = new Map<string, string>() // projectId → workdir
const mockProjectRecords = new Map<string, { workspaceRootDir?: string }>() // workdir → data

/**
 * In-memory SQLite database for MCP overrides integration test.
 * Allows verifying that updateSessionMcpDisabledServers does not touch updated_at.
 */
let mockDb: Database.Database | undefined

vi.mock('../db/index.js', () => ({
  getDatabase: () => {
    if (!mockDb) throw new Error('mockDb not initialized for test')
    return mockDb
  },
}))

vi.mock('../db/projects.js', () => ({
  getProjectByWorkdir: vi.fn((workdir: string) => {
    let record = mockProjectRecords.get(workdir)
    if (!record) {
      record = {}
      mockProjectRecords.set(workdir, record)
    }
    mockProjectById.set('test-project', workdir)
    return { id: 'test-project', workspaceRootDir: record.workspaceRootDir }
  }),
  updateProject: vi.fn((id: string, updates: { workspaceRootDir?: string | null }) => {
    const workdir = mockProjectById.get(id)
    if (workdir && updates.workspaceRootDir !== undefined) {
      const record = mockProjectRecords.get(workdir)
      if (record) {
        if (updates.workspaceRootDir === null) {
          delete record.workspaceRootDir
        } else {
          record.workspaceRootDir = updates.workspaceRootDir
        }
      }
    }
  }),
}))

beforeEach(() => {
  mockProjectById.clear()
  mockProjectRecords.clear()
})

interface ValidateResponse {
  exists: boolean
  resolvedPath: string
  created?: boolean
  workspaces?: { name: string }[]
}

interface ConfigResponse {
  config: { rootDir?: string; setup?: string[] }
}

describe('POST /api/workspace/config/validate', () => {
  let app: express.Express
  let server: ReturnType<typeof app.listen>
  let baseUrl: string
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-ws-config-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })

    app = express()
    app.use(express.json())
    app.use(
      '/api/workspace',
      createWorkspaceConfigRoutes({
        listSessions: () => [],
        setDynamicContextChanged: () => {},
      } as any),
    )

    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as any).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    server?.close()
    await rm(testDir, { recursive: true, force: true })
  })

  it('returns exists:false when rootDir does not exist', async () => {
    const missingPath = join(testDir, 'nonexistent')

    const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: missingPath, workdir: testDir }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as ValidateResponse
    expect(body.exists).toBe(false)
    expect(body.resolvedPath).toBe(resolve(missingPath))
  })

  it('returns exists:true when rootDir already exists', async () => {
    const existingPath = join(testDir, 'existing-dir')
    await mkdir(existingPath, { recursive: true })

    const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: existingPath, workdir: testDir }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as ValidateResponse
    expect(body.exists).toBe(true)
  })

  it('creates rootDir when createIfMissing is true', async () => {
    const newPath = join(testDir, 'will-be-created')

    const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: newPath, workdir: testDir, createIfMissing: true }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as ValidateResponse
    expect(body.exists).toBe(true)
    expect(body.created).toBe(true)

    const { stat } = await import('node:fs/promises')
    const st = await stat(newPath)
    expect(st.isDirectory()).toBe(true)
  })

  it('resolves relative rootDir against workdir', async () => {
    const relativePath = './my-workspaces'
    const resolvedPath = resolve(testDir, 'my-workspaces')

    const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: relativePath, workdir: testDir }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as ValidateResponse
    expect(body.resolvedPath).toBe(resolvedPath)
  })

  it('returns 400 when rootDir is missing', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workdir: testDir }),
    })

    expect(res.status).toBe(400)
  })

  it('returns 400 when workdir is missing', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: '/some/path' }),
    })

    expect(res.status).toBe(400)
  })

  it('returns 400 for dangerous system path', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: '/etc', workdir: testDir }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/Use a subdirectory instead/i)
  })

  it('returns 400 for virtual filesystem prefix', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: '/proc/self/fd/1', workdir: testDir }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/Cannot use paths under/i)
  })

  it('returns 400 for non-writable existing directory', async () => {
    const restrictedPath = join(testDir, 'restricted')
    await mkdir(restrictedPath, { recursive: true })
    // Remove write permissions to simulate non-writable directory
    const { chmod } = await import('node:fs/promises')
    await chmod(restrictedPath, 0o444)

    const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: restrictedPath, workdir: testDir }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/not writable/i)
  })

  describe('workspace migration detection', () => {
    it('returns existing workspaces from old rootDir when rootDir changes', async () => {
      const oldRootDir = join(testDir, 'old-workspaces')
      const ws1 = join(oldRootDir, 'fix-bug')
      const ws2 = join(oldRootDir, 'add-feature')
      await mkdir(join(ws1, '.git'), { recursive: true })
      await mkdir(join(ws2, '.git'), { recursive: true })
      await writeFile(join(ws1, '.git', 'HEAD'), 'ref: refs/heads/main\n')
      await writeFile(join(ws2, '.git', 'HEAD'), 'ref: refs/heads/main\n')

      const saveRes = await fetch(`${baseUrl}/api/workspace/config?workdir=${encodeURIComponent(testDir)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir: oldRootDir }),
      })
      expect(saveRes.status).toBe(200)

      const newRootDir = join(testDir, 'new-workspaces')

      const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir: newRootDir, workdir: testDir }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ValidateResponse
      expect(body.workspaces).toBeDefined()
      expect(Array.isArray(body.workspaces)).toBe(true)
      expect(body.workspaces!.length).toBeGreaterThanOrEqual(2)
      const names = body.workspaces!.map((w: { name: string }) => w.name).sort()
      expect(names).toContain('fix-bug')
      expect(names).toContain('add-feature')
    })

    it('returns empty workspaces list when rootDir does not change', async () => {
      const rootDir = join(testDir, 'stable-workspaces')
      await mkdir(rootDir, { recursive: true })

      const saveRes = await fetch(`${baseUrl}/api/workspace/config?workdir=${encodeURIComponent(testDir)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir }),
      })
      expect(saveRes.status).toBe(200)

      const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir, workdir: testDir }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ValidateResponse
      expect(body.workspaces).toEqual([])
    })

    /** Saves rootDir as the project's current one, with a git workspace inside it. */
    async function saveRootDirWithWorkspace(rootDir: string): Promise<void> {
      await mkdir(join(rootDir, 'fix-bug', '.git'), { recursive: true })
      const saveRes = await fetch(`${baseUrl}/api/workspace/config?workdir=${encodeURIComponent(testDir)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir }),
      })
      expect(saveRes.status).toBe(200)
    }

    it('treats a trailing separator as the same rootDir', async () => {
      const rootDir = join(testDir, 'trailing-workspaces')
      await saveRootDirWithWorkspace(rootDir)

      const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir: `${rootDir}/`, workdir: testDir }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ValidateResponse
      expect(body.workspaces).toEqual([])
    })

    // Windows only: paths there are case-insensitive and separators interchangeable,
    // so the same directory spelled differently must not read as a workspace move.
    it.skipIf(process.platform !== 'win32')(
      'treats case and separator differences as the same rootDir on Windows',
      async () => {
        const rootDir = join(testDir, 'case-workspaces')
        await saveRootDirWithWorkspace(rootDir)

        const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rootDir: rootDir.toUpperCase().replace(/\\/g, '/'), workdir: testDir }),
        })

        expect(res.status).toBe(200)
        const body = (await res.json()) as ValidateResponse
        expect(body.workspaces).toEqual([])
      },
    )

    it('returns empty workspaces list when config has no previous rootDir', async () => {
      const newRootDir = join(testDir, 'fresh-workspaces')

      const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir: newRootDir, workdir: testDir }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ValidateResponse
      expect(body.workspaces).toEqual([])
    })

    it('detects default global dir orphans when projectName provided', async () => {
      const origXdg = process.env['XDG_DATA_HOME']
      process.env['XDG_DATA_HOME'] = testDir
      try {
        const defaultDir = join(testDir, 'openfox', 'workspaces', 'my-project')
        const ws1 = join(defaultDir, 'fix-bug')
        await mkdir(join(ws1, '.git'), { recursive: true })
        await writeFile(join(ws1, '.git', 'HEAD'), 'ref: refs/heads/main\n')

        const newRootDir = join(testDir, 'custom-workspaces')

        const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rootDir: newRootDir,
            workdir: testDir,
            projectName: 'my-project',
          }),
        })

        expect(res.status).toBe(200)
        const body = (await res.json()) as ValidateResponse
        expect(body.workspaces).toBeDefined()
        expect(body.workspaces!.length).toBe(1)
        expect(body.workspaces![0]!.name).toBe('fix-bug')
      } finally {
        if (origXdg !== undefined) process.env['XDG_DATA_HOME'] = origXdg
        else delete process.env['XDG_DATA_HOME']
      }
    })

    it('returns empty workspaces list from default dir when projectName is not provided', async () => {
      const newRootDir = join(testDir, 'other-workspaces')

      const res = await fetch(`${baseUrl}/api/workspace/config/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir: newRootDir, workdir: testDir }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ValidateResponse
      expect(body.workspaces).toEqual([])
    })
  })
})

describe('POST /api/workspace/config (existing endpoint)', () => {
  let app: express.Express
  let server: ReturnType<typeof app.listen>
  let baseUrl: string
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-ws-config-save-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })

    app = express()
    app.use(express.json())
    app.use(
      '/api/workspace',
      createWorkspaceConfigRoutes({
        listSessions: () => [],
        setDynamicContextChanged: () => {},
      } as any),
    )

    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as any).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    server?.close()
    await rm(testDir, { recursive: true, force: true })
  })

  it('saves config with rootDir', async () => {
    const rootDir = join(testDir, 'target')
    await mkdir(rootDir, { recursive: true })

    const res = await fetch(`${baseUrl}/api/workspace/config?workdir=${encodeURIComponent(testDir)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as ConfigResponse
    expect(body.config.rootDir).toBe(rootDir)
  })

  it('returns 400 when workdir query param is missing', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: '/some/path' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when neither setup nor rootDir is provided', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/config?workdir=${encodeURIComponent(testDir)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('rejects dangerous exact path', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/config?workdir=${encodeURIComponent(testDir)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: '/etc', setup: ['npm install'] }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/Use a subdirectory instead/i)
  })

  it('rejects dangerous path with virtual fs prefix', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/config?workdir=${encodeURIComponent(testDir)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: '/proc/self', setup: ['npm install'] }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/Cannot use paths under/i)
  })

  it('rejects non-writable existing directory', async () => {
    const restrictedPath = join(testDir, 'restricted-save')
    await mkdir(restrictedPath, { recursive: true })
    const { chmod } = await import('node:fs/promises')
    await chmod(restrictedPath, 0o444)

    const res = await fetch(`${baseUrl}/api/workspace/config?workdir=${encodeURIComponent(testDir)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: restrictedPath, setup: ['npm install'] }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/not writable/i)
  })

  it('strips empty rootDir and saves setup', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/config?workdir=${encodeURIComponent(testDir)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: '', setup: ['npm install'] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ConfigResponse
    expect(body.config.rootDir).toBeUndefined()
    expect(body.config.setup).toEqual(['npm install'])
  })

  it('strips whitespace-only rootDir and saves setup', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/config?workdir=${encodeURIComponent(testDir)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: '   ', setup: ['npm install'] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ConfigResponse
    expect(body.config.rootDir).toBeUndefined()
    expect(body.config.setup).toEqual(['npm install'])
  })
})

describe('POST /api/workspace/config with MCP overrides', () => {
  let app: express.Express
  let server: ReturnType<typeof app.listen>
  let baseUrl: string
  let testDir: string

  const SESSION_1_ID = 'mcp-session-1'
  const SESSION_2_ID = 'mcp-session-2'
  const FROZEN_TIME = '2024-01-01T00:00:00.000Z'

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-ws-config-mcp-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })

    mockDb = new Database(':memory:')
    mockDb.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workdir TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'planner',
        phase TEXT NOT NULL DEFAULT 'idle',
        workflow_phase TEXT NOT NULL DEFAULT 'plan',
        is_running INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        title TEXT,
        total_tokens_used INTEGER DEFAULT 0,
        total_tool_calls INTEGER DEFAULT 0,
        iteration_count INTEGER DEFAULT 0,
        provider_id TEXT,
        provider_model TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        mcp_disabled_servers TEXT,
        danger_level TEXT NOT NULL DEFAULT 'normal',
        workspace TEXT,
        branch TEXT
      )
    `)
    mockDb
      .prepare(
        `
      INSERT INTO sessions (id, project_id, workdir, mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(SESSION_1_ID, 'test-project', testDir, 'builder', FROZEN_TIME, FROZEN_TIME)
    mockDb
      .prepare(
        `
      INSERT INTO sessions (id, project_id, workdir, mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(SESSION_2_ID, 'test-project', testDir, 'planner', FROZEN_TIME, FROZEN_TIME)

    app = express()
    app.use(express.json())
    app.use(
      '/api/workspace',
      createWorkspaceConfigRoutes({
        listSessions: () => [
          {
            id: SESSION_1_ID,
            projectId: 'test-project',
            workdir: testDir,
            mode: 'builder',
            phase: 'build',
            isRunning: false,
            createdAt: FROZEN_TIME,
            updatedAt: FROZEN_TIME,
            criteriaCount: 0,
            criteriaCompleted: 0,
            messageCount: 0,
          },
          {
            id: SESSION_2_ID,
            projectId: 'test-project',
            workdir: testDir,
            mode: 'planner',
            phase: 'plan',
            isRunning: false,
            createdAt: FROZEN_TIME,
            updatedAt: FROZEN_TIME,
            criteriaCount: 0,
            criteriaCompleted: 0,
            messageCount: 0,
          },
        ],
        setDynamicContextChanged: () => {},
      } as any),
    )

    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as any).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    server?.close()
    mockDb?.close()
    mockDb = undefined
    await rm(testDir, { recursive: true, force: true })
  })

  it('does not change session updated_at when saving MCP overrides', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/config?workdir=${encodeURIComponent(testDir)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mcpOverrides: { 'server-1': { disabled: true }, 'server-2': { disabled: true } },
      }),
    })

    expect(res.status).toBe(200)

    const session1 = mockDb!
      .prepare('SELECT updated_at, mcp_disabled_servers FROM sessions WHERE id = ?')
      .get(SESSION_1_ID) as { updated_at: string; mcp_disabled_servers: string | null }
    const session2 = mockDb!
      .prepare('SELECT updated_at, mcp_disabled_servers FROM sessions WHERE id = ?')
      .get(SESSION_2_ID) as { updated_at: string; mcp_disabled_servers: string | null }

    expect(session1.updated_at).toBe(FROZEN_TIME)
    expect(session2.updated_at).toBe(FROZEN_TIME)
    expect(session1.mcp_disabled_servers).toBe(JSON.stringify(['server-1', 'server-2']))
    expect(session2.mcp_disabled_servers).toBe(JSON.stringify(['server-1', 'server-2']))
  })

  it('does not change session updated_at when clearing MCP overrides', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/config?workdir=${encodeURIComponent(testDir)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mcpOverrides: {},
      }),
    })

    expect(res.status).toBe(200)

    const session1 = mockDb!.prepare('SELECT updated_at FROM sessions WHERE id = ?').get(SESSION_1_ID) as {
      updated_at: string
    }

    expect(session1.updated_at).toBe(FROZEN_TIME)
  })
})
