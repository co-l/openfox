import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import { mkdir, rm, writeFile, stat, readFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { createPermissionsRoutes } from './permissions.js'
import { getProjectPermissionsKey } from '../permissions/registry.js'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from '../db/index.js'
import { setSetting } from '../db/settings.js'
import { addAllowedPath, addSessionAllowedRule, clearAllowedPaths } from '../tools/path-security.js'

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
  closeDatabase()
  const dbConfig = loadConfig()
  dbConfig.database.path = ':memory:'
  initDatabase(dbConfig)
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
    expect(data.config).toMatchObject(config)
  })

  it('returns project config from the database', async () => {
    const config = { version: 1, rules: [{ effect: 'ALLOW', tool: 'read_file', pattern: '/x/**' }] }
    setSetting(getProjectPermissionsKey(PROJECT_DIR), JSON.stringify(config))
    const res = await fetch(`${baseUrl}/api/permissions?scope=project&workdir=${PROJECT_DIR}`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { config: unknown }
    expect(data.config).toMatchObject(config)
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
    expect(data.config).toMatchObject(config)
    const saved = JSON.parse(await readFile(join(GLOBAL_DIR, 'permissions.json'), 'utf-8'))
    expect(saved).toMatchObject(config)
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

describe('per-rule routes', () => {
  const denyRule = { effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }

  async function addRule(rule: unknown, scope = 'global', workdir?: string) {
    const query = workdir ? `scope=${scope}&workdir=${workdir}` : `scope=${scope}`
    return fetch(`${baseUrl}/api/permissions/rules?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    })
  }

  it('POST /rules adds one rule and returns the full config', async () => {
    const res = await addRule(denyRule)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { config: { rules: { id: string; tool: string }[] } }
    expect(data.config.rules).toHaveLength(1)
    expect(data.config.rules[0]!.id).toBeTruthy()
    expect(data.config.rules[0]!.tool).toBe('run_command')
  })

  it('POST /rules rejects an invalid rule', async () => {
    const res = await addRule({ effect: 'ALLOW', tool: 'web_fetch' })
    expect(res.status).toBe(400)
  })

  it('PUT /rules/:id replaces that rule only', async () => {
    await addRule(denyRule)
    const second = await addRule({ effect: 'ALLOW', tool: 'read_file', pattern: '/x/**' })
    const config = (await second.json()) as { config: { rules: { id: string }[] } }
    const targetId = config.config.rules[1]!.id
    const res = await fetch(`${baseUrl}/api/permissions/rules/${targetId}?scope=global`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effect: 'ASK', tool: 'read_file', pattern: '/y/**' }),
    })
    expect(res.status).toBe(200)
    const updated = (await res.json()) as { config: { rules: { id: string; effect: string; pattern: string }[] } }
    expect(updated.config.rules[0]!.effect).toBe('DENY')
    expect(updated.config.rules[1]).toEqual({ id: targetId, effect: 'ASK', tool: 'read_file', pattern: '/y/**' })
  })

  it('PUT /rules/:id returns 404 for an unknown id', async () => {
    const res = await fetch(`${baseUrl}/api/permissions/rules/nope?scope=global`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(denyRule),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /rules/:id removes that rule only', async () => {
    const first = await addRule(denyRule)
    const firstConfig = (await first.json()) as { config: { rules: { id: string }[] } }
    await addRule({ effect: 'ALLOW', tool: 'read_file', pattern: '/x/**' })
    const res = await fetch(`${baseUrl}/api/permissions/rules/${firstConfig.config.rules[0]!.id}?scope=global`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { config: { rules: { tool: string }[] } }
    expect(data.config.rules).toHaveLength(1)
    expect(data.config.rules[0]!.tool).toBe('read_file')
  })

  it('DELETE /rules/:id returns 404 for an unknown id', async () => {
    const res = await fetch(`${baseUrl}/api/permissions/rules/nope?scope=global`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })

  it('rejects project scope without workdir', async () => {
    const res = await addRule(denyRule, 'project')
    expect(res.status).toBe(400)
  })
})

describe('session grants', () => {
  beforeEach(() => {
    clearAllowedPaths('grants-a')
    clearAllowedPaths('grants-b')
  })
  afterEach(() => {
    clearAllowedPaths('grants-a')
    clearAllowedPaths('grants-b')
  })

  const grantsFor = async (sessionId: string) => {
    const res = await fetch(`${baseUrl}/api/permissions/grants`)
    const { grants } = (await res.json()) as {
      grants: {
        sessionId: string
        paths: { path: string; tool?: string; reason?: string; grantedAt: number }[]
        rules: { tool: string; pattern?: string; grantedAt: number }[]
      }[]
    }
    return grants.find((grant) => grant.sessionId === sessionId)
  }

  it('lists paths and promoted rules per session', async () => {
    addAllowedPath('grants-a', '/home/u/.ssh/id_rsa', { tool: 'read_file', reason: 'sensitive_file' })
    addSessionAllowedRule('grants-a', { effect: 'ALLOW', tool: 'read_file', pattern: '**/.ssh/**' })
    addAllowedPath('grants-b', '/etc/shadow')
    expect(await grantsFor('grants-a')).toEqual({
      sessionId: 'grants-a',
      paths: [
        {
          path: normalize('/home/u/.ssh/id_rsa'),
          tool: 'read_file',
          reason: 'sensitive_file',
          grantedAt: expect.any(Number),
        },
      ],
      rules: [{ effect: 'ALLOW', tool: 'read_file', pattern: '**/.ssh/**', grantedAt: expect.any(Number) }],
    })
    expect((await grantsFor('grants-b'))?.paths.map((grant) => grant.path)).toEqual([normalize('/etc/shadow')])
  })

  it('keeps the first approval when the same path is approved again', async () => {
    addAllowedPath('grants-a', '/etc/shadow', { tool: 'read_file', reason: 'outside_workdir' })
    addAllowedPath('grants-a', '/etc/shadow', { tool: 'write_file', reason: 'sensitive_file' })
    const grant = (await grantsFor('grants-a'))?.paths[0]
    expect(grant).toMatchObject({ tool: 'read_file', reason: 'outside_workdir' })
  })

  it('omits sessions without any grant', async () => {
    expect(await grantsFor('grants-a')).toBeUndefined()
  })

  it('revokes a single path', async () => {
    addAllowedPath('grants-a', '/etc/shadow')
    addAllowedPath('grants-a', '/etc/sudoers')
    const res = await fetch(
      `${baseUrl}/api/permissions/grants/grants-a/paths?path=${encodeURIComponent('/etc/shadow')}`,
      {
        method: 'DELETE',
      },
    )
    expect(res.status).toBe(200)
    expect((await grantsFor('grants-a'))?.paths.map((grant) => grant.path)).toEqual([normalize('/etc/sudoers')])
  })

  it('revokes a promoted rule by tool and pattern', async () => {
    addSessionAllowedRule('grants-a', { effect: 'ALLOW', tool: 'run_command', pattern: '*/.ssh/*' })
    const url = `${baseUrl}/api/permissions/grants/grants-a/rules?tool=run_command&pattern=${encodeURIComponent('*/.ssh/*')}`
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(200)
    expect(await grantsFor('grants-a')).toBeUndefined()
  })

  it('revokes a promoted rule that has no pattern', async () => {
    addSessionAllowedRule('grants-a', { effect: 'ALLOW', tool: 'web_fetch' })
    const res = await fetch(`${baseUrl}/api/permissions/grants/grants-a/rules?tool=web_fetch`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await grantsFor('grants-a')).toBeUndefined()
  })

  it('clears every grant of a session and leaves the others', async () => {
    addAllowedPath('grants-a', '/etc/shadow')
    addSessionAllowedRule('grants-a', { effect: 'ALLOW', tool: 'read_file', pattern: '**/.ssh/**' })
    addAllowedPath('grants-b', '/etc/sudoers')
    expect((await fetch(`${baseUrl}/api/permissions/grants/grants-a`, { method: 'DELETE' })).status).toBe(200)
    expect(await grantsFor('grants-a')).toBeUndefined()
    expect((await grantsFor('grants-b'))?.paths.map((grant) => grant.path)).toEqual([normalize('/etc/sudoers')])
  })

  it('answers 404 for a grant that is gone and 400 for a missing parameter', async () => {
    const gone = await fetch(`${baseUrl}/api/permissions/grants/grants-a/paths?path=%2Fnope`, { method: 'DELETE' })
    expect(gone.status).toBe(404)
    const noPath = await fetch(`${baseUrl}/api/permissions/grants/grants-a/paths`, { method: 'DELETE' })
    expect(noPath.status).toBe(400)
    const noTool = await fetch(`${baseUrl}/api/permissions/grants/grants-a/rules`, { method: 'DELETE' })
    expect(noTool.status).toBe(400)
  })

  it('filters GET /grants by sessionId and answers 404 for a session without grants', async () => {
    addAllowedPath('grants-a', '/etc/shadow')
    addAllowedPath('grants-b', '/etc/sudoers')
    const res = await fetch(`${baseUrl}/api/permissions/grants?sessionId=grants-a`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { grants: { sessionId: string; paths: { path: string }[] }[] }
    expect(data.grants).toHaveLength(1)
    expect(data.grants[0]!.sessionId).toBe('grants-a')
    expect(data.grants[0]!.paths.map((grant) => grant.path)).toEqual([normalize('/etc/shadow')])
    const unknown = await fetch(`${baseUrl}/api/permissions/grants?sessionId=does-not-exist`)
    expect(unknown.status).toBe(404)
  })

  it('answers 404 when clearing the grants of a session that holds none', async () => {
    const res = await fetch(`${baseUrl}/api/permissions/grants/grants-a`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})
