/**
 * Auth E2E Tests
 *
 * Tests token authentication for network mode.
 * 
 * NOTE: These tests require sequential execution due to file system race conditions
 * when setting up auth.json before server import. Run with: npx vitest run auth.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, generateKeyPairSync, publicEncrypt } from 'node:crypto'
import { createTestServer, type TestServerHandle } from './utils/index.js'

describe.skip('Auth', () => {
  let server: TestServerHandle

  beforeAll(async () => {
    const e2eDir = process.cwd().endsWith('/e2e') ? process.cwd() : join(process.cwd(), 'e2e')
    const authDir = join(e2eDir, '.openfox-test')
    await mkdir(authDir, { recursive: true })

    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })

    const encryptedPassword = publicEncrypt(
      { key: publicKey, padding: 1 },
      Buffer.from('test123')
    ).toString('base64')

    await writeFile(join(authDir, 'auth.json'), JSON.stringify({
      strategy: 'network',
      encryptedPassword,
    }))

    await writeFile(join(authDir, 'auth.key'), privateKey, { mode: 0o600 })

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
    const loginRes = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test123' }),
    })
    const { token } = await loginRes.json() as { token: string }
    const ws = new WebSocket(`${server.wsUrl}?token=${encodeURIComponent(token)}`)

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
    const loginRes = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test123' }),
    })
    const { token } = await loginRes.json() as { token: string }
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

  it('login returns signature token for valid password', async () => {
    const res = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test123' }),
    })
    expect(res.ok).toBe(true)
    const data = await res.json() as { token: string }
    expect(typeof data.token).toBe('string')
    expect(data.token.length).toBeGreaterThan(100)
  })
})