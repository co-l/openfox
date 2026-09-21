import { describe, expect, it } from 'vitest'
import { createLLMClient } from './client.js'

function createConfig(model: string, backend = 'opencode-go') {
  return {
    llm: {
      baseUrl: 'http://localhost:8000',
      timeout: 12_000,
      model,
      backend,
    },
  } as never
}

describe('per-model Responses API routing in createLLMClient', () => {
  it('flags Responses-API models on backends that speak them', () => {
    expect(createLLMClient(createConfig('gpt-5.6-luna')).usesResponsesApi?.()).toBe(true)
    expect(createLLMClient(createConfig('openai/gpt-5.6-luna')).usesResponsesApi?.()).toBe(true)
    expect(createLLMClient(createConfig('grok-4.6')).usesResponsesApi?.()).toBe(true)
  })

  it('flags the gpt-5 family on the openai backend via the profile', () => {
    expect(createLLMClient(createConfig('gpt-5.6-luna', 'openai')).usesResponsesApi?.()).toBe(true)
    expect(createLLMClient(createConfig('gpt-5', 'openai')).usesResponsesApi?.()).toBe(true)
  })

  it('keeps chat/completions for models not routed to responses', () => {
    expect(createLLMClient(createConfig('glm-5.3-flash')).usesResponsesApi?.()).toBe(false)
    expect(createLLMClient(createConfig('qwen3-32b')).usesResponsesApi?.()).toBe(false)
  })

  it('does NOT flag responses-class models on backends that only speak chat completions', () => {
    expect(createLLMClient(createConfig('gpt-5.6-luna', 'vllm')).usesResponsesApi?.()).toBe(false)
  })

  it('follows model switches at runtime', () => {
    const client = createLLMClient(createConfig('glm-5.3-flash'))
    expect(client.usesResponsesApi?.()).toBe(false)
    client.setModel('grok-4.6')
    expect(client.usesResponsesApi?.()).toBe(true)
    client.setModel('kimi-k3')
    expect(client.usesResponsesApi?.()).toBe(false)
  })
})
