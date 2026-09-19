/**
 * Settings REST API E2E Tests
 *
 * Tests settings get/set operations via REST API (not WebSocket).
 * Following TDD: these tests should FAIL initially before implementation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestServer, type TestServerHandle } from './utils/index.js'

describe('Settings REST API', () => {
  let server: TestServerHandle

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  describe('GET /api/settings/:key', () => {
    it('returns null for non-existent setting', async () => {
      const response = await fetch(`${server.url}/api/settings/nonexistent-key`)

      expect(response.status).toBe(200)
      const data: any = await response.json()
      expect(data.key).toBe('nonexistent-key')
      expect(data.value).toBeNull()
    })

    it('returns previously set value', async () => {
      // Set a value first
      const setRes = await fetch(`${server.url}/api/settings/test-key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'test-value' }),
      })
      expect(setRes.status).toBe(200)

      // Get it back
      const response = await fetch(`${server.url}/api/settings/test-key`)
      expect(response.status).toBe(200)
      const data: any = await response.json()
      expect(data.key).toBe('test-key')
      expect(data.value).toBe('test-value')
    })
  })

  describe('PUT /api/settings/:key', () => {
    it('sets a new setting value', async () => {
      const response = await fetch(`${server.url}/api/settings/new-setting`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'new-value' }),
      })

      expect(response.status).toBe(200)
      const data: any = await response.json()
      expect(data.key).toBe('new-setting')
      expect(data.value).toBe('new-value')
    })

    it('updates an existing setting', async () => {
      // Set initial value
      await fetch(`${server.url}/api/settings/update-key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'initial' }),
      })

      // Update it
      const response = await fetch(`${server.url}/api/settings/update-key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'updated' }),
      })

      expect(response.status).toBe(200)
      const data: any = await response.json()
      expect(data.value).toBe('updated')

      // Verify with get
      const getResponse = await fetch(`${server.url}/api/settings/update-key`)
      const getPayload: any = await getResponse.json()
      expect(getPayload.value).toBe('updated')
    })

    it('handles complex string values', async () => {
      const complexValue = JSON.stringify({ nested: { key: 'value' }, array: [1, 2, 3] })

      const response = await fetch(`${server.url}/api/settings/complex`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: complexValue }),
      })

      expect(response.status).toBe(200)
      const data: any = await response.json()
      expect(data.value).toBe(complexValue)
    })
  })

  describe('Settings Persistence', () => {
    it('persists settings across requests', async () => {
      // Set value
      await fetch(`${server.url}/api/settings/persist-test`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'persisted-value' }),
      })

      // Get it back in same "session" (in-memory DB)
      const response = await fetch(`${server.url}/api/settings/persist-test`)
      const payload: any = await response.json()
      expect(payload.value).toBe('persisted-value')
    })
  })

  describe('line verbs on /api/settings/:key', () => {
    const lineKey = 'global_instructions'
    const seed =
      '## Preferences\n\n- Always answer in English\n- Prefer terse output\n\n## Infra\n\n- Neo runs Matrix\n'

    const readValue = async (): Promise<string> => {
      const res = await fetch(`${server.url}/api/settings/${lineKey}`)
      return ((await res.json()) as { value: string | null }).value ?? ''
    }

    const verb = async (method: string, key: string, body: unknown) => {
      const res = await fetch(`${server.url}/api/settings/${key}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return { status: res.status, body: (await res.json()) as Record<string, unknown> }
    }

    const putValue = async (value: string) => {
      await fetch(`${server.url}/api/settings/${lineKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
    }

    beforeEach(async () => {
      await putValue(seed)
    })

    it('POST appends one line and reports the change', async () => {
      const res = await verb('POST', lineKey, { line: '- Never log secrets' })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ key: lineKey, changed: true, matched: 0, lineCount: 6 })
      expect(res.body).toMatchObject({ added: ['- Never log secrets'], removed: [] })
      expect(res.body['message']).toMatch(/Appended 1 line \(6 total\)/)
      expect(await readValue()).toBe(seed + '- Never log secrets\n')
    })

    it('POST with an identical line is a reported no-op', async () => {
      const res = await verb('POST', lineKey, { line: '- Prefer terse output' })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ changed: false, matched: 1, lineCount: 5 })
      expect(await readValue()).toBe(seed)
    })

    it('PATCH replaces every exact match and nothing else', async () => {
      const res = await verb('PATCH', lineKey, { match: '- Prefer terse output', line: '- Prefer terse answers' })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ changed: true, matched: 1 })
      expect(res.body).toMatchObject({ removed: ['- Prefer terse output'], added: ['- Prefer terse answers'] })
      expect(await readValue()).toBe(
        '## Preferences\n\n- Always answer in English\n- Prefer terse answers\n\n## Infra\n\n- Neo runs Matrix\n',
      )
    })

    it('PATCH on a duplicated line reports every replacement', async () => {
      await putValue('- dupe\n- keep\n- dupe')
      const res = await verb('PATCH', lineKey, { match: '- dupe', line: '- fixed' })
      expect(res.body).toMatchObject({ changed: true, matched: 2 })
      expect(await readValue()).toBe('- fixed\n- keep\n- fixed')
    })

    it('PATCH with no exact match is a 404 and changes nothing', async () => {
      const res = await verb('PATCH', lineKey, { match: 'terse', line: 'nope' })
      expect(res.status).toBe(404)
      expect(res.body).toMatchObject({ changed: false, matched: 0 })
      expect(await readValue()).toBe(seed)
    })

    it('DELETE removes every exact match and keeps the structure', async () => {
      const res = await verb('DELETE', lineKey, { line: '- Prefer terse output' })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ changed: true, matched: 1, removed: ['- Prefer terse output'], added: [] })
      expect(await readValue()).toBe('## Preferences\n\n- Always answer in English\n\n## Infra\n\n- Neo runs Matrix\n')
    })

    it('DELETE with no exact match is a 404 and changes nothing', async () => {
      const res = await verb('DELETE', lineKey, { line: 'terse' })
      expect(res.status).toBe(404)
      expect(res.body).toMatchObject({ changed: false, matched: 0 })
      expect(await readValue()).toBe(seed)
    })

    it('rejects blank and multi-line input on every verb', async () => {
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        const blank = await verb(method, lineKey, { line: '   ' })
        expect(blank.status, method).toBe(400)
        expect(blank.body['error']).toMatch(/required/i)

        const multi = await verb(method, lineKey, { line: 'a\nb' })
        expect(multi.status, method).toBe(400)
        expect(multi.body['error']).toMatch(/single line/i)
      }
      const patchWithoutMatch = await verb('PATCH', lineKey, { line: 'x' })
      expect(patchWithoutMatch.status).toBe(400)
      expect(await readValue()).toBe(seed)
    })

    it('refuses to line-address any other setting and leaves it alone', async () => {
      await fetch(`${server.url}/api/settings/display.theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'dark' }),
      })
      for (const [method, body] of [
        ['POST', { line: 'x' }],
        ['PATCH', { match: 'dark', line: 'x' }],
        ['DELETE', { line: 'dark' }],
      ] as const) {
        const res = await verb(method, 'display.theme', body)
        expect(res.status, method).toBe(405)
        expect(res.body['error']).toMatch(/PUT/)
      }
      const get = await fetch(`${server.url}/api/settings/display.theme`)
      expect(((await get.json()) as { value: string }).value).toBe('dark')
    })
  })
})
