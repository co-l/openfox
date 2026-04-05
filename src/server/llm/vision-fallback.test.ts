import { describe, it, expect, beforeEach, vi } from 'vitest'
import { describeImage, describeImageFromDataUrl, setVisionFallbackConfig, getVisionFallbackConfig, isVisionFallbackEnabled } from './vision-fallback.js'

global.fetch = vi.fn()

describe('vision-fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setVisionFallbackConfig({ enabled: false, url: 'http://localhost:11434', model: 'qwen3-vl:2b' })
  })

  describe('describeImage', () => {
    it('returns fallback message when disabled', async () => {
      const result = await describeImage('dGVzdA==')
      expect(result).toBe('[Image - vision fallback not enabled]')
    })

    it('returns description from API when enabled', async () => {
      setVisionFallbackConfig({ enabled: true })
      const mockResponse = {
        ok: true,
        json: async () => ({ message: { content: 'A test image showing a cat' } })
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const result = await describeImage('dGVzdA==')
      expect(result).toBe('A test image showing a cat')
    })

    it('returns error message on API failure', async () => {
      setVisionFallbackConfig({ enabled: true })
      const mockResponse = {
        ok: false,
        status: 500,
        text: async () => 'Internal error'
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const result = await describeImage('dGVzdA==')
      expect(result).toContain('HTTP 500')
    })
  })

  describe('describeImageFromDataUrl', () => {
    it('extracts base64 from data URL', async () => {
      setVisionFallbackConfig({ enabled: true })
      const mockResponse = {
        ok: true,
        json: async () => ({ message: { content: 'A test image' } })
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const dataUrl = 'data:image/png;base64,dGVzdA=='
      const result = await describeImageFromDataUrl(dataUrl)
      expect(result).toBe('A test image')
    })

    it('returns error for invalid data URL', async () => {
      const result = await describeImageFromDataUrl('not-a-data-url')
      expect(result).toBe('[Invalid image data URL]')
    })
  })

  describe('config management', () => {
    it('sets and gets config', () => {
      setVisionFallbackConfig({ enabled: true, url: 'http://custom:11434', model: 'custom-model' })
      const config = getVisionFallbackConfig()
      expect(config.enabled).toBe(true)
      expect(config.url).toBe('http://custom:11434')
      expect(config.model).toBe('custom-model')
    })

    it('isVisionFallbackEnabled returns correct state', () => {
      expect(isVisionFallbackEnabled()).toBe(false)
      setVisionFallbackConfig({ enabled: true })
      expect(isVisionFallbackEnabled()).toBe(true)
    })
  })
})