import { describe, expect, it } from 'vitest'
import { formatModelValue, parseModelValue, isReasoningEffortValue, REASONING_EFFORT_VALUES } from './model-value'

describe('isReasoningEffortValue', () => {
  it('recognizes known effort values', () => {
    expect(isReasoningEffortValue('low')).toBe(true)
    expect(isReasoningEffortValue('high')).toBe(true)
    expect(isReasoningEffortValue('none')).toBe(true)
    expect(isReasoningEffortValue('minimal')).toBe(true)
  })

  it('rejects non-effort strings', () => {
    expect(isReasoningEffortValue('70b')).toBe(false)
    expect(isReasoningEffortValue('')).toBe(false)
  })

  it('stays in sync with the server vocabulary (includes minimal)', () => {
    expect(REASONING_EFFORT_VALUES).toContain('minimal')
  })
})

describe('formatModelValue', () => {
  it('formats provider/model without effort', () => {
    expect(formatModelValue('local', 'deepseek-v4-flash')).toBe('local/deepseek-v4-flash')
  })

  it('appends the effort suffix when provided and valid', () => {
    expect(formatModelValue('local', 'deepseek-v4-flash', 'high')).toBe('local/deepseek-v4-flash:high')
    expect(formatModelValue('local', 'gpt-5', 'minimal')).toBe('local/gpt-5:minimal')
    expect(formatModelValue('local', 'gemini-3.7-flash', 'low')).toBe('local/gemini-3.7-flash:low')
  })

  it('ignores an invalid effort suffix', () => {
    expect(formatModelValue('local', 'deepseek-v4-flash', '70b')).toBe('local/deepseek-v4-flash')
    expect(formatModelValue('local', 'deepseek-v4-flash', 'latest')).toBe('local/deepseek-v4-flash')
  })
})

describe('parseModelValue', () => {
  it('parses provider/model without effort', () => {
    expect(parseModelValue('local/deepseek-v4-flash')).toEqual({ providerId: 'local', model: 'deepseek-v4-flash' })
  })

  it('parses provider/model:effort', () => {
    expect(parseModelValue('local/deepseek-v4-flash:high')).toEqual({
      providerId: 'local',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    })
    expect(parseModelValue('local/gemini-3.7-flash:low')).toEqual({
      providerId: 'local',
      model: 'gemini-3.7-flash',
      reasoningEffort: 'low',
    })
  })

  it('parses minimal as an effort, not part of the model id', () => {
    expect(parseModelValue('local/gpt-5:minimal')).toEqual({
      providerId: 'local',
      model: 'gpt-5',
      reasoningEffort: 'minimal',
    })
  })

  it('keeps a colon in the model id for Ollama model tags and non-effort suffixes', () => {
    expect(parseModelValue('local/deepseek-r1:70b')).toEqual({ providerId: 'local', model: 'deepseek-r1:70b' })
    expect(parseModelValue('ollama/llama3:latest')).toEqual({ providerId: 'ollama', model: 'llama3:latest' })
    expect(parseModelValue('ollama/codellama:instruct')).toEqual({ providerId: 'ollama', model: 'codellama:instruct' })
    expect(parseModelValue('ollama/qwen2.5-coder:32b')).toEqual({ providerId: 'ollama', model: 'qwen2.5-coder:32b' })
  })

  it('handles provider ids containing slashes (nested model ids)', () => {
    expect(parseModelValue('org/deepseek-ai/deepseek-v4-flash:max')).toEqual({
      providerId: 'org',
      model: 'deepseek-ai/deepseek-v4-flash',
      reasoningEffort: 'max',
    })
  })

  it('returns undefined for empty or malformed values', () => {
    expect(parseModelValue(undefined)).toBeUndefined()
    expect(parseModelValue('')).toBeUndefined()
    expect(parseModelValue('no-slash')).toBeUndefined()
    expect(parseModelValue('/model')).toBeUndefined()
  })
})
