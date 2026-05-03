import { describe, it, expect } from 'vitest'
import { getModelProfile, modelSupportsReasoning } from './profiles.js'

describe('profiles', () => {
  describe('getModelProfile', () => {
    it('returns Mistral profile for mistral models with supportsReasoning: false', () => {
      const profile = getModelProfile('mistral-small-4')

      expect(profile.name).toBe('Mistral')
      expect(profile.supportsReasoning).toBe(false)
    })

    it('returns Mistral profile for various mistral model names', () => {
      const variants = ['mistral-small-4', 'Mistral-Large-2', 'mistral-7b', 'mistral-nemo']

      for (const model of variants) {
        const profile = getModelProfile(model)
        expect(profile.name).toBe('Mistral')
        expect(profile.supportsReasoning).toBe(false)
      }
    })

    it('returns Qwen3 profile with supportsReasoning: true', () => {
      const profile = getModelProfile('qwen3-32b')

      expect(profile.name).toBe('Qwen3')
      expect(profile.supportsReasoning).toBe(true)
    })

    it('returns Qwen3-Coder-Next profile with supportsReasoning: false', () => {
      const profile = getModelProfile('qwen3-coder-next-32b')

      expect(profile.name).toBe('Qwen3-Coder-Next')
      expect(profile.supportsReasoning).toBe(false)
    })

    it('returns Llama profile with supportsReasoning: false', () => {
      const profile = getModelProfile('llama-3-70b')

      expect(profile.name).toBe('Llama')
      expect(profile.supportsReasoning).toBe(false)
    })

    it('returns default profile for unknown models', () => {
      const profile = getModelProfile('some-unknown-model')

      expect(profile.name).toBe('default')
      expect(profile.supportsReasoning).toBe(false) // default is conservative - no reasoning
    })
  })

  describe('modelSupportsReasoning', () => {
    it('returns false for mistral models', () => {
      expect(modelSupportsReasoning('mistral-small-4')).toBe(false)
    })

    it('returns true for qwen3 models', () => {
      expect(modelSupportsReasoning('qwen3-32b')).toBe(true)
    })

    it('returns false for llama models', () => {
      expect(modelSupportsReasoning('llama-3-70b')).toBe(false)
    })
  })
})
