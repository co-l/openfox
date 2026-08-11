import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import { mkdir, rm, writeFile, stat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPermissionsRoutes } from './permissions.js'

const TEST_DIR = join(tmpdir(), 'openfox-permissions-route-test')
const GLOBAL_DIR = join(TEST_DIR, 'global')
const PROJECT_DIR = join(TEST_DIR, 'project')

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

let app: express.Express
let server: ReturnType<typeof app.listen>
let baseUrl: string

beforeEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
  await mkdir(GLOBAL_DIR, { recursive: true })
  await mkdir(PROJECT_DIR, { recursive: true })
  await mkdir(join(PROJECT_DIR, '.openfox'), { recursive: true })
  app = express()
  app.use(express.json())
  app.use('/api/permissions', createPermissionsRoutes(GLOBAL_DIR))
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`
        resolve()
      }
    })
  })
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('GET /api/permissions', () => {
  it('returns empty config when no file exists', async () => {
    const res = await fetch(`${baseUrl}/api/permissions?scope=global`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { config: unknown }
    expect(data).toEqual({ config: { version: 1, rules: [] } })
  })

  it('returns config when file exists', async () => {
    const config = { version: 1, rules: [{ effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }] }
    await writeFile(join(GLOBAL_DIR, 'permissions.json'), JSON.stringify(config))
    const res = await fetch(`${baseUrl}/api/permissions?scope=global`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { config: unknown }
    expect(data.config).toEqual(config)
  })

  it('returns project config from .openfox/permissions.json', async () => {
    const config = { version: 1, rules: [{ effect: 'ALLOW', tool: 'read_file', pattern: '/x/**' }] }
    await writeFile(join(PROJECT_DIR, '.openfox', 'permissions.json'), JSON.stringify(config))
    const res = await fetch(`${baseUrl}/api/permissions?scope=project&workdir=${PROJECT_DIR}`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { config: unknown }
    expect(data.config).toEqual(config)
  })

  it('rejects missing scope', async () => {
    const res = await fetch(`${baseUrl}/api/permissions`)
    expect(res.status).toBe(400)
  })

  it('rejects invalid scope', async () => {
    const res = await fetch(`${baseUrl}/api/permissions?scope=invalid`)
    expect(res.status).toBe(400)
  })

  it('rejects project scope without workdir', async () => {
    const res = await fetch(`${baseUrl}/api/permissions?scope=project`)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/permissions', () => {
  it('saves config and returns it', async () => {
    const config = {
      version: 1,
      rules: [{ effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
    }
    const res = await fetch(`${baseUrl}/api/permissions?scope=global`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { config: unknown }
    expect(data.config).toEqual(config)
    const saved = JSON.parse(await readFile(join(GLOBAL_DIR, 'permissions.json'), 'utf-8'))
    expect(saved).toEqual(config)
  })

  it('deletes file when rules empty', async () => {
    await writeFile(
      join(GLOBAL_DIR, 'permissions.json'),
      JSON.stringify({ version: 1, rules: [{ effect: 'DENY', tool: 'x' }] }),
    )
    const res = await fetch(`${baseUrl}/api/permissions?scope=global`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, rules: [] }),
    })
    expect(res.status).toBe(200)
    await expect(stat(join(GLOBAL_DIR, 'permissions.json'))).rejects.toThrow()
  })

  it('rejects invalid config (bad effect)', async () => {
    const res = await fetch(`${baseUrl}/api/permissions?scope=global`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, rules: [{ effect: 'BAD', tool: 'x' }] }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing scope', async () => {
    const res = await fetch(`${baseUrl}/api/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, rules: [] }),
    })
    expect(res.status).toBe(400)
  })
})
