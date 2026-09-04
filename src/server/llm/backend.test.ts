import { describe, it, expect } from 'vitest'
import {
  detectBackendFromUrl,
  detectProviderDefaultsFromUrl,
  getBackendCapabilities,
  getBackendDisplayName,
  type Backend,
} from './backend.js'

describe('backend', () => {
  describe('detectBackendFromUrl', () => {
    it('detects openai for api.openai.com', () => {
      expect(detectBackendFromUrl('https://api.openai.com/v1')).toBe('openai')
      expect(detectBackendFromUrl('https://api.openai.com')).toBe('openai')
    })

    it('detects anthropic for api.anthropic.com', () => {
      expect(detectBackendFromUrl('https://api.anthropic.com/v1')).toBe('anthropic')
    })

    it('returns undefined for local or unknown hosts', () => {
      expect(detectBackendFromUrl('http://localhost:11434')).toBeUndefined()
      expect(detectBackendFromUrl('http://localhost:8000/v1')).toBeUndefined()
      expect(detectBackendFromUrl('https://my-vllm.example.com/v1')).toBeUndefined()
    })

    it('ignores case and trailing slash', () => {
      expect(detectBackendFromUrl('HTTPS://API.OPENAI.COM/')).toBe('openai')
    })
  })

  describe('detectProviderDefaultsFromUrl', () => {
    it('derives the DeepSeek reasoning field from the API host', () => {
      expect(detectProviderDefaultsFromUrl('https://api.deepseek.com')).toEqual({ thinkingField: 'reasoning_content' })
      expect(detectProviderDefaultsFromUrl('https://api.deepseek.com/v1')).toEqual({
        thinkingField: 'reasoning_content',
      })
    })

    it('returns undefined for local or unknown hosts', () => {
      expect(detectProviderDefaultsFromUrl('http://localhost:8000')).toBeUndefined()
      expect(detectProviderDefaultsFromUrl('http://192.168.1.223:8000/v1')).toBeUndefined()
      expect(detectProviderDefaultsFromUrl('https://api.z.ai/api/paas/v4')).toBeUndefined()
    })

    it('ignores case and trailing slash', () => {
      expect(detectProviderDefaultsFromUrl('HTTPS://API.DEEPSEEK.COM/')).toEqual({ thinkingField: 'reasoning_content' })
    })

    it('returns undefined for malformed urls', () => {
      expect(detectProviderDefaultsFromUrl('not-a-url')).toBeUndefined()
    })
  })

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
      expect(caps.usesMaxCompletionTokens).toBe(true)
    })

    it('returns correct capabilities for anthropic', () => {
      const caps = getBackendCapabilities('anthropic')
      expect(caps.supportsChatTemplateKwargs).toBe(false)
      expect(caps.supportsTopK).toBe(false)
      expect(caps.usesMaxCompletionTokens).toBe(false)
    })

    it('returns correct capabilities for ollama', () => {
      const caps = getBackendCapabilities('ollama')
      expect(caps.supportsChatTemplateKwargs).toBe(false)
      expect(caps.supportsTopK).toBe(false)
      expect(caps.usesMaxCompletionTokens).toBe(false)
    })

    it('returns correct capabilities for llamacpp', () => {
      const caps = getBackendCapabilities('llamacpp')
      expect(caps.supportsChatTemplateKwargs).toBe(false)
      expect(caps.supportsTopK).toBe(true)
      expect(caps.routesEffortViaChatTemplateKwargs).toBe(true)
      expect(caps.usesMaxCompletionTokens).toBe(false)
    })

    it('returns vllm-like capabilities for unknown', () => {
      const caps = getBackendCapabilities('unknown')
      expect(caps.supportsChatTemplateKwargs).toBe(true)
      expect(caps.supportsTopK).toBe(true)
      expect(caps.routesEffortViaChatTemplateKwargs).toBe(false)
      expect(caps.usesMaxCompletionTokens).toBe(false)
    })

    it('does not route effort via chat_template_kwargs for other backends', () => {
      for (const backend of [
        'vllm',
        'sglang',
        'openai',
        'anthropic',
        'ollama',
        'lmstudio',
        'unsloth',
        'opencode-go',
      ] as const) {
        expect(getBackendCapabilities(backend).routesEffortViaChatTemplateKwargs).toBe(false)
      }
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
        unsloth: 'Unsloth Studio',
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
