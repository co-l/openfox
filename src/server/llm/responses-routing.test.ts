import { describe, expect, it } from 'vitest'
import { isResponsesApiModel, resolveApiProtocol } from './responses-routing.js'

describe('resolveApiProtocol', () => {
  it('routes gpt-5 family to responses on the openai backend via the profile', () => {
    expect(resolveApiProtocol({ model: 'gpt-5.6-luna', backend: 'openai', profileApiProtocol: 'responses' })).toBe(
      'responses',
    )
    expect(resolveApiProtocol({ model: 'gpt-5', backend: 'openai', profileApiProtocol: 'responses' })).toBe('responses')
  })

  it('routes curated OpenCode Go models to responses on the opencode-go backend', () => {
    expect(resolveApiProtocol({ model: 'gpt-5.6-luna', backend: 'opencode-go' })).toBe('responses')
    expect(resolveApiProtocol({ model: 'grok-4.6', backend: 'opencode-go' })).toBe('responses')
    expect(resolveApiProtocol({ model: 'muse-spark-1.2-contributor', backend: 'opencode-go' })).toBe('responses')
  })

  it('routes curated OpenCode Go models to responses on an unknown backend', () => {
    // Providers created before the curated table existed (or added as "Other")
    // carry backend 'unknown'; none of the local inference engines serve these
    // ids, so the curated match still applies.
    expect(resolveApiProtocol({ model: 'gpt-5.6-luna', backend: 'unknown' })).toBe('responses')
    expect(resolveApiProtocol({ model: 'grok-4.6', backend: 'unknown' })).toBe('responses')
    expect(resolveApiProtocol({ model: 'muse-spark-1.2-contributor', backend: 'unknown' })).toBe('responses')
  })

  it('does NOT route responses-class models on backends that only speak chat completions', () => {
    expect(resolveApiProtocol({ model: 'gpt-5.6-luna', backend: 'vllm', profileApiProtocol: 'responses' })).toBe(
      'chat-completions',
    )
    expect(resolveApiProtocol({ model: 'gpt-5.6-luna', backend: 'ollama' })).toBe('chat-completions')
    expect(resolveApiProtocol({ model: 'grok-4.6', backend: 'sglang' })).toBe('chat-completions')
  })

  it('defaults to chat completions for unknown models', () => {
    expect(resolveApiProtocol({ model: 'deepseek-v4-pro', backend: 'openai' })).toBe('chat-completions')
    expect(resolveApiProtocol({ model: 'glm-5.3-flash', backend: 'opencode-go' })).toBe('chat-completions')
    expect(resolveApiProtocol({ model: '', backend: 'openai' })).toBe('chat-completions')
  })

  it('lets an explicit per-model override win', () => {
    expect(
      resolveApiProtocol({
        model: 'gpt-5.6-luna',
        backend: 'openai',
        profileApiProtocol: 'responses',
        explicitApiProtocol: 'chat-completions',
      }),
    ).toBe('chat-completions')
    expect(resolveApiProtocol({ model: 'glm-5.3-flash', backend: 'vllm', explicitApiProtocol: 'responses' })).toBe(
      'responses',
    )
  })

  it('matches org-prefixed model ids on their last path segment', () => {
    expect(resolveApiProtocol({ model: 'openai/gpt-5.6-luna', backend: 'opencode-go' })).toBe('responses')
  })

  it('matches case-insensitively', () => {
    expect(resolveApiProtocol({ model: 'GPT-5.6-Luna', backend: 'opencode-go' })).toBe('responses')
  })

  it('does not match ids that merely contain a routed id as a prefix', () => {
    expect(resolveApiProtocol({ model: 'gpt-5.6-luna-experimental', backend: 'opencode-go' })).toBe('chat-completions')
    expect(resolveApiProtocol({ model: 'grok-4.6-turbo', backend: 'opencode-go' })).toBe('chat-completions')
  })
})

describe('isResponsesApiModel', () => {
  it('returns true only when the model resolves to the responses protocol', () => {
    expect(isResponsesApiModel({ model: 'gpt-5.6-luna', backend: 'opencode-go' })).toBe(true)
    expect(isResponsesApiModel({ model: 'gpt-5.6-luna', backend: 'vllm' })).toBe(false)
    expect(isResponsesApiModel({ model: 'glm-5.3-flash', backend: 'opencode-go' })).toBe(false)
  })
})
