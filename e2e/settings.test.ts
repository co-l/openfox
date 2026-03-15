/**
 * Settings E2E Tests
 * 
 * Tests settings get/set operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestClient, type TestClient } from './utils/index.js'

describe('Settings', () => {
  let client: TestClient

  beforeEach(async () => {
    client = await createTestClient()
  })

  afterEach(async () => {
    await client.close()
  })

  describe('settings.get', () => {
    it('returns null for non-existent setting', async () => {
      const response = await client.send('settings.get', { key: 'nonexistent-key' })

      expect(response.type).toBe('settings.value')
      const payload = response.payload as { key: string; value: string | null }
      expect(payload.key).toBe('nonexistent-key')
      expect(payload.value).toBeNull()
    })

    it('returns previously set value', async () => {
      // Set a value first
      await client.send('settings.set', { key: 'test-key', value: 'test-value' })

      // Get it back
      const response = await client.send('settings.get', { key: 'test-key' })

      expect(response.type).toBe('settings.value')
      const payload = response.payload as { key: string; value: string | null }
      expect(payload.key).toBe('test-key')
      expect(payload.value).toBe('test-value')
    })
  })

  describe('settings.set', () => {
    it('sets a new setting value', async () => {
      const response = await client.send('settings.set', { 
        key: 'new-setting', 
        value: 'new-value' 
      })

      expect(response.type).toBe('settings.value')
      const payload = response.payload as { key: string; value: string | null }
      expect(payload.key).toBe('new-setting')
      expect(payload.value).toBe('new-value')
    })

    it('updates an existing setting', async () => {
      // Set initial value
      await client.send('settings.set', { key: 'update-key', value: 'initial' })

      // Update it
      const response = await client.send('settings.set', { 
        key: 'update-key', 
        value: 'updated' 
      })

      expect(response.type).toBe('settings.value')
      const payload = response.payload as { key: string; value: string | null }
      expect(payload.value).toBe('updated')

      // Verify with get
      const getResponse = await client.send('settings.get', { key: 'update-key' })
      const getPayload = getResponse.payload as { value: string | null }
      expect(getPayload.value).toBe('updated')
    })

    it('handles complex string values', async () => {
      const complexValue = JSON.stringify({ nested: { key: 'value' }, array: [1, 2, 3] })
      
      await client.send('settings.set', { key: 'complex', value: complexValue })
      
      const response = await client.send('settings.get', { key: 'complex' })
      const payload = response.payload as { value: string | null }
      expect(payload.value).toBe(complexValue)
    })
  })

  describe('Settings Persistence', () => {
    it('persists settings across connections', async () => {
      // Set value with first client
      await client.send('settings.set', { key: 'persist-test', value: 'persisted-value' })
      
      // Create new client and verify
      const client2 = await createTestClient()
      try {
        const response = await client2.send('settings.get', { key: 'persist-test' })
        const payload = response.payload as { value: string | null }
        expect(payload.value).toBe('persisted-value')
      } finally {
        await client2.close()
      }
    })
  })
})
