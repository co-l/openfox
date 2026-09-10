import { describe, expect, it } from 'vitest'
import {
  formatModelValue,
  parseModelValue,
  formatShortModelLabel,
  resolveSubAgentModelLabel,
  isReasoningEffortValue,
  REASONING_EFFORT_VALUES,
} from './model-value'

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

describe('formatShortModelLabel', () => {
  it('strips provider prefixes and formats model name', () => {
    expect(formatShortModelLabel('gemini-3.7-flash-medium')).toBe('gemini-3.7-flash-medium')
    expect(formatShortModelLabel('provider-1/gemini-3.7-flash-medium')).toBe('gemini-3.7-flash-medium')
    expect(formatShortModelLabel('openrouter/anthropic/claude-3.5-haiku')).toBe('claude-3.5-haiku')
  })

  it('appends reasoning effort when present', () => {
    expect(formatShortModelLabel('gemini-3.7-flash-medium', 'high')).toBe('gemini-3.7-flash-medium:high')
    expect(formatShortModelLabel('provider-1/deepseek-v4-flash', 'max')).toBe('deepseek-v4-flash:max')
  })
})

describe('resolveSubAgentModelLabel', () => {
  it('prioritizes message stats from executed turns', () => {
    const messages = [
      {
        id: 'm1',
        role: 'assistant' as const,
        content: 'done',
        timestamp: new Date().toISOString(),
        stats: {
          providerId: 'p1',
          providerName: 'P1',
          backend: 'openai' as const,
          model: 'provider-1/gemini-3.7-flash-medium',
          reasoningEffort: 'medium',
          mode: 'verifier' as const,
          totalTime: 10,
          toolTime: 2,
          prefillTokens: 100,
          prefillSpeed: 10,
          generationTokens: 50,
          generationSpeed: 5,
        },
      },
    ]

    const result = resolveSubAgentModelLabel({
      messages,
      subAgentType: 'verifier',
      modelOverrides: { verifier: 'other-provider/other-model' },
      sessionProviderModel: 'session-model',
      defaultModelSelection: 'default-provider/default-model',
    })

    expect(result).toBe('gemini-3.7-flash-medium:medium')
  })

  it('uses agent model override when no message stats exist', () => {
    const result = resolveSubAgentModelLabel({
      messages: [],
      subAgentType: 'code_reviewer',
      modelOverrides: { code_reviewer: 'custom-provider/deepseek-v4-flash:high' },
      sessionProviderModel: 'session-model',
      defaultModelSelection: 'default-provider/default-model',
    })

    expect(result).toBe('deepseek-v4-flash:high')
  })

  it('uses session provider model when no message stats and no agent override exist', () => {
    const result = resolveSubAgentModelLabel({
      messages: [],
      subAgentType: 'explorer',
      modelOverrides: {},
      sessionProviderModel: 'my-org/claude-3.5-sonnet',
      sessionReasoningEffort: 'low',
      defaultModelSelection: 'default-provider/default-model',
    })

    expect(result).toBe('claude-3.5-sonnet:low')
  })

  it('uses default model selection when no stats, override, or session model exist', () => {
    const result = resolveSubAgentModelLabel({
      messages: [],
      subAgentType: 'explorer',
      modelOverrides: {},
      sessionProviderModel: null,
      defaultModelSelection: 'ollama/qwen2.5-coder:32b',
    })

    expect(result).toBe('qwen2.5-coder:32b')
  })

  it('returns undefined when no model can be resolved', () => {
    const result = resolveSubAgentModelLabel({
      messages: [],
      subAgentType: 'explorer',
    })

    expect(result).toBeUndefined()
  })
})
