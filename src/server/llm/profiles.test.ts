import { describe, it, expect } from 'vitest'
import { getModelProfile } from './profiles.js'

describe('profiles', () => {
  describe('getModelProfile', () => {
    it('returns Mistral profile for mistral models', () => {
      const profile = getModelProfile('mistral-small-4')

      expect(profile.name).toBe('Mistral')
    })

    it('returns Mistral profile for various mistral model names', () => {
      const variants = ['mistral-small-4', 'Mistral-Large-2', 'mistral-7b', 'mistral-nemo']

      for (const model of variants) {
        const profile = getModelProfile(model)
        expect(profile.name).toBe('Mistral')
      }
    })

    it('returns Qwen3 profile', () => {
      const profile = getModelProfile('qwen3-32b')

      expect(profile.name).toBe('Qwen3')
    })

    it('returns Qwen3-Coder-Next profile', () => {
      const profile = getModelProfile('qwen3-coder-next-32b')

      expect(profile.name).toBe('Qwen3-Coder-Next')
    })

    it('returns Llama profile', () => {
      const profile = getModelProfile('llama-3-70b')

      expect(profile.name).toBe('Llama')
    })

    it('returns default profile for unknown models', () => {
      const profile = getModelProfile('some-unknown-model')

      expect(profile.name).toBe('default')
    })
  })
})
