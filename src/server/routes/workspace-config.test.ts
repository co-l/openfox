import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createWorkspaceConfigRoutes } from './workspace-config.js'

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
    app.use('/api/workspace', createWorkspaceConfigRoutes())

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
    app.use('/api/workspace', createWorkspaceConfigRoutes())

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
})
