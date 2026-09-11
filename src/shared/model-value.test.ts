import { describe, expect, it } from 'vitest'
import { formatModelValue, parseModelValue } from './model-value.js'

describe('formatModelValue', () => {
  it('formats provider and model without effort', () => {
    expect(formatModelValue('openai', 'gpt-4o')).toBe('openai/gpt-4o')
  })

  it('formats provider, model, and valid reasoning effort', () => {
    expect(formatModelValue('anthropic', 'claude-3-7-sonnet', 'high')).toBe('anthropic/claude-3-7-sonnet:high')
  })

  it('omits invalid reasoning effort', () => {
    expect(formatModelValue('openai', 'gpt-4o', 'ultra')).toBe('openai/gpt-4o')
  })
})

describe('parseModelValue', () => {
  it('parses valid provider and model', () => {
    expect(parseModelValue('openai/gpt-4o')).toEqual({ providerId: 'openai', model: 'gpt-4o' })
  })

  it('parses valid provider, model, and reasoning effort', () => {
    expect(parseModelValue('anthropic/claude-3-7-sonnet:high')).toEqual({
      providerId: 'anthropic',
      model: 'claude-3-7-sonnet',
      reasoningEffort: 'high',
    })
  })

  it('handles models with colons like tag versions', () => {
    expect(parseModelValue('ollama/deepseek-r1:70b')).toEqual({
      providerId: 'ollama',
      model: 'deepseek-r1:70b',
    })
  })

  it('returns undefined for invalid values', () => {
    expect(parseModelValue(undefined)).toBeUndefined()
    expect(parseModelValue('')).toBeUndefined()
    expect(parseModelValue('no-slash')).toBeUndefined()
    expect(parseModelValue('/no-provider')).toBeUndefined()
  })
})
