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

    it('returns gpt-5 profile with the OpenAI-required temperature of 1', () => {
      const profile = getModelProfile('gpt-5.6-luna')

      expect(profile.name).toBe('GPT-5')
      expect(profile.temperature).toBe(1.0)
      expect(profile.topP).toBe(1.0)
    })

    it('returns Qwen3.8 profile matching the model card for coding (thinking mode)', () => {
      const profile = getModelProfile('qwen3.8-27b')

      expect(profile.name).toBe('Qwen3.8')
      expect(profile.temperature).toBe(1.0)
      expect(profile.topP).toBe(0.95)
      expect(profile.topK).toBe(20)
      expect(profile.defaultMaxTokens).toBeGreaterThanOrEqual(50000)
      expect(profile.supportsVision).toBe(true)
    })

    it('returns DeepSeek profile with temperature 1 per model card', () => {
      const profile = getModelProfile('deepseek-v4-flash')

      expect(profile.name).toBe('DeepSeek')
      expect(profile.temperature).toBe(1)
    })

    it('returns Llama profile', () => {
      const profile = getModelProfile('llama-3-70b')

      expect(profile.name).toBe('Llama')
    })

    it('returns default profile for unknown models', () => {
      const profile = getModelProfile('some-unknown-model')

      expect(profile.name).toBe('default')
      expect(profile.defaultMaxTokens).toBeGreaterThanOrEqual(16384)
    })
  })
})
