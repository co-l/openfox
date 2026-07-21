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
