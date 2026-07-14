import { describe, it, expect } from 'vitest'
import { getBackendCapabilities, getBackendDisplayName, type Backend } from './backend.js'

describe('backend', () => {
  describe('getBackendCapabilities', () => {
    it('returns correct capabilities for vllm', () => {
      const caps = getBackendCapabilities('vllm')
      expect(caps.supportsChatTemplateKwargs).toBe(true)
      expect(caps.supportsTopK).toBe(true)
    })

    it('returns correct capabilities for sglang', () => {
      const caps = getBackendCapabilities('sglang')
      expect(caps.supportsChatTemplateKwargs).toBe(true)
      expect(caps.supportsTopK).toBe(true)
    })

    it('returns correct capabilities for openai', () => {
      const caps = getBackendCapabilities('openai')
      expect(caps.supportsChatTemplateKwargs).toBe(false)
      expect(caps.supportsTopK).toBe(false)
    })

    it('returns correct capabilities for anthropic', () => {
      const caps = getBackendCapabilities('anthropic')
      expect(caps.supportsChatTemplateKwargs).toBe(false)
      expect(caps.supportsTopK).toBe(false)
    })

    it('returns correct capabilities for ollama', () => {
      const caps = getBackendCapabilities('ollama')
      expect(caps.supportsChatTemplateKwargs).toBe(false)
      expect(caps.supportsTopK).toBe(false)
    })

    it('returns correct capabilities for llamacpp', () => {
      const caps = getBackendCapabilities('llamacpp')
      expect(caps.supportsChatTemplateKwargs).toBe(false)
      expect(caps.supportsTopK).toBe(true)
    })

    it('returns vllm-like capabilities for unknown', () => {
      const caps = getBackendCapabilities('unknown')
      expect(caps.supportsChatTemplateKwargs).toBe(true)
      expect(caps.supportsTopK).toBe(true)
    })
  })

  describe('getBackendDisplayName', () => {
    it('returns friendly names for all backends', () => {
      const cases: Record<Backend, string> = {
        vllm: 'vLLM',
        sglang: 'SGLang',
        ollama: 'Ollama',
        llamacpp: 'llama.cpp',
        lmstudio: 'LM Studio',
        'opencode-go': 'OpenCode Go',
        openai: 'OpenAI',
        anthropic: 'Anthropic',
        unknown: 'Other',
      }

      for (const [backend, name] of Object.entries(cases) as Array<[Backend, string]>) {
        expect(getBackendDisplayName(backend)).toBe(name)
      }
    })
  })
})
