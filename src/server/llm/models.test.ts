import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { clearModelCache, detectModel, getCachedModel, getLlmStatus, getModelInfo } from './models.js'

describe('models', () => {
  beforeEach(() => {
    clearModelCache()
    vi.restoreAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
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
      expect(getCachedModel()).toBe('test-model')
      expect(getModelInfo()).toMatchObject({ id: 'test-model' })
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

    it('retries failed requests and keeps cached model when refresh fails later', async () => {
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1_000)
        .mockReturnValueOnce(35_000)

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          object: 'list',
          data: [{ id: 'cached-model', object: 'model', created: 123, owned_by: 'test', root: 'root', max_model_len: 200000 }],
        }),
      } as Response)

      expect(await detectModel('http://localhost:8000', 1)).toBe('cached-model')
      expect(getCachedModel()).toBe('cached-model')

      fetchSpy
        .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
        .mockResolvedValueOnce({ ok: false, status: 503 } as Response)

      const refresh = detectModel('http://localhost:8000', 2)
      await vi.runAllTimersAsync()
      await expect(refresh).resolves.toBe('cached-model')
      expect(getLlmStatus()).toBe('disconnected')
      expect(fetchSpy).toHaveBeenCalledWith('http://localhost:8000/v1/models', expect.any(Object))
    })

    it('returns null after repeated thrown errors and clears the cache cleanly', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))

      const result = detectModel('http://localhost:8000/v1', 2, true)
      await vi.runAllTimersAsync()
      await expect(result).resolves.toBeNull()
      expect(fetchSpy).toHaveBeenCalledTimes(2)

      clearModelCache()
      expect(getCachedModel()).toBeNull()
      expect(getModelInfo()).toBeNull()
      expect(getLlmStatus()).toBe('unknown')
    })
  })
})
