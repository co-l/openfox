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
})
