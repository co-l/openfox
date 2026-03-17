import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { detectBackend, getBackendCapabilities, type Backend } from './backend.js'

describe('backend', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('detectBackend', () => {
    it('detects Ollama when /api/tags returns successfully', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (String(url).includes('/api/tags')) {
          return { ok: true, json: async () => ({ models: [] }) } as Response
        }
        return { ok: false } as Response
      })

      const backend = await detectBackend('http://localhost:11434')
      expect(backend).toBe('ollama')
    })

    it('detects llama.cpp when /health returns llama.cpp markers', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (String(url).includes('/api/tags')) {
          return { ok: false } as Response
        }
        if (String(url).includes('/health')) {
          return { 
            ok: true, 
            json: async () => ({ status: 'ok', slots_idle: 1, slots_processing: 0 }) 
          } as Response
        }
        return { ok: false } as Response
      })

      const backend = await detectBackend('http://localhost:8080')
      expect(backend).toBe('llamacpp')
    })

    it('detects SGLang when /get_model_info returns successfully', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (String(url).includes('/api/tags')) {
          return { ok: false } as Response
        }
        if (String(url).includes('/health')) {
          return { ok: false } as Response
        }
        if (String(url).includes('/get_model_info')) {
          return { ok: true, json: async () => ({ model_path: 'test' }) } as Response
        }
        return { ok: false } as Response
      })

      const backend = await detectBackend('http://localhost:30000')
      expect(backend).toBe('sglang')
    })

    it('defaults to vllm when /v1/models works but no other markers', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (String(url).includes('/api/tags')) {
          return { ok: false } as Response
        }
        if (String(url).includes('/health')) {
          return { ok: false } as Response
        }
        if (String(url).includes('/get_model_info')) {
          return { ok: false } as Response
        }
        if (String(url).includes('/v1/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'test-model' }] }) } as Response
        }
        return { ok: false } as Response
      })

      const backend = await detectBackend('http://localhost:8000/v1')
      expect(backend).toBe('vllm')
    })

    it('returns unknown when nothing responds', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'))

      const backend = await detectBackend('http://localhost:9999')
      expect(backend).toBe('unknown')
    })

    it('respects explicit backend override', async () => {
      const backend = await detectBackend('http://localhost:8000', 'sglang')
      expect(backend).toBe('sglang')
    })
  })

  describe('getBackendCapabilities', () => {
    it('returns correct capabilities for vllm', () => {
      const caps = getBackendCapabilities('vllm')
      expect(caps.supportsReasoningField).toBe(true)
      expect(caps.supportsChatTemplateKwargs).toBe(true)
      expect(caps.supportsTopK).toBe(true)
    })

    it('returns correct capabilities for sglang', () => {
      const caps = getBackendCapabilities('sglang')
      expect(caps.supportsReasoningField).toBe(true)
      expect(caps.supportsChatTemplateKwargs).toBe(true)
      expect(caps.supportsTopK).toBe(true)
    })

    it('returns correct capabilities for ollama', () => {
      const caps = getBackendCapabilities('ollama')
      expect(caps.supportsReasoningField).toBe(false)
      expect(caps.supportsChatTemplateKwargs).toBe(false)
      expect(caps.supportsTopK).toBe(false)
    })

    it('returns correct capabilities for llamacpp', () => {
      const caps = getBackendCapabilities('llamacpp')
      expect(caps.supportsReasoningField).toBe(false)
      expect(caps.supportsChatTemplateKwargs).toBe(false)
      expect(caps.supportsTopK).toBe(true)
    })

    it('returns vllm-like capabilities for unknown', () => {
      const caps = getBackendCapabilities('unknown')
      expect(caps.supportsReasoningField).toBe(true)
      expect(caps.supportsChatTemplateKwargs).toBe(true)
      expect(caps.supportsTopK).toBe(true)
    })
  })
})
