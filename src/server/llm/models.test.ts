import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { detectModel, getLlmStatus, clearModelCache } from './models.js'

describe('models', () => {
  beforeEach(() => {
    clearModelCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getLlmStatus', () => {
    it('returns "unknown" before any detection attempt', () => {
      expect(getLlmStatus()).toBe('unknown')
    })

    it('returns "connected" after successful model detection', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          object: 'list',
          data: [{ id: 'test-model', object: 'model', created: 123, owned_by: 'test' }],
        }),
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response)

      const model = await detectModel('http://localhost:8000/v1', 1)
      
      expect(model).toBe('test-model')
      expect(getLlmStatus()).toBe('connected')
    })

    it('returns "disconnected" after all retries fail', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'))

      const model = await detectModel('http://localhost:8000/v1', 1)
      
      expect(model).toBeNull()
      expect(getLlmStatus()).toBe('disconnected')
    })

    it('returns "disconnected" when server returns non-ok response', async () => {
      const mockResponse = {
        ok: false,
        status: 503,
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response)

      const model = await detectModel('http://localhost:8000/v1', 1)
      
      expect(model).toBeNull()
      expect(getLlmStatus()).toBe('disconnected')
    })

    it('returns "disconnected" when server returns empty model list', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          object: 'list',
          data: [],
        }),
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response)

      const model = await detectModel('http://localhost:8000/v1', 1)
      
      expect(model).toBeNull()
      expect(getLlmStatus()).toBe('disconnected')
    })
  })

  describe('detectModel', () => {
    it('returns cached model within TTL without re-fetching', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          object: 'list',
          data: [{ id: 'test-model', object: 'model', created: 123, owned_by: 'test' }],
        }),
      }
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response)

      // First call - should fetch
      const model1 = await detectModel('http://localhost:8000/v1', 1)
      expect(model1).toBe('test-model')
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      // Second call - should use cache
      const model2 = await detectModel('http://localhost:8000/v1', 1)
      expect(model2).toBe('test-model')
      expect(fetchSpy).toHaveBeenCalledTimes(1) // Still 1, no new fetch
    })
  })
})
