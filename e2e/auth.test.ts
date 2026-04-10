/**
 * Auth E2E Tests
 *
 * Tests token authentication for network mode.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createTestServer, type TestServerHandle } from './utils/index.js'

describe('Auth', () => {
  let server: TestServerHandle

  beforeAll(async () => {
    const e2eDir = process.cwd().endsWith('/e2e') ? process.cwd() : join(process.cwd(), 'e2e')
    const authDir = join(e2eDir, '.openfox-test')
    await mkdir(authDir, { recursive: true })

    const passwordHash = createHash('sha256').update('test123').digest('hex')
    await writeFile(join(authDir, 'auth.json'), JSON.stringify({
      strategy: 'network',
      passwordHash,
    }))

    server = await createTestServer()
  })

  afterAll(async () => {
    const e2eDir = process.cwd().endsWith('/e2e') ? process.cwd() : join(process.cwd(), 'e2e')
    await rm(join(e2eDir, '.openfox-test'), { recursive: true, force: true })
  })

  it('rejects connection without token', async () => {
    const ws = new WebSocket(server.wsUrl)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('Connection should have been rejected'))
      }, 3000)

      ws.on('close', (code) => {
        clearTimeout(timeout)
        expect(code).toBeGreaterThan(0)
        resolve()
      })

      ws.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  })

  it('accepts connection with valid token', async () => {
    const token = createHash('sha256').update('test123').digest('hex')
    const ws = new WebSocket(`${server.wsUrl}?token=${token}`)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('Connection timeout'))
      }, 3000)

      ws.on('open', () => {
        clearTimeout(timeout)
        expect(ws.readyState).toBe(WebSocket.OPEN)
        ws.close()
        resolve()
      })

      ws.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  })

  it('rejects REST API without token', async () => {
    const res = await fetch(`${server.url}/api/projects`)
    expect(res.status).toBe(401)
  })

  it('allows REST API with token', async () => {
    const token = createHash('sha256').update('test123').digest('hex')
    const res = await fetch(`${server.url}/api/projects`, {
      headers: { 'x-session-token': token },
    })
    expect(res.ok).toBe(true)
  })

  it('login returns 401 for invalid password', async () => {
    const res = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    })
    expect(res.status).toBe(401)
  })

  it('login returns token for valid password (token = password hash)', async () => {
    const res = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test123' }),
    })
    expect(res.ok).toBe(true)
    const data = await res.json() as { token: string }
    expect(data.token).toBe(createHash('sha256').update('test123').digest('hex'))
  })
})