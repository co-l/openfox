import { describe, expect, it } from 'vitest'
import { createLLMClient } from './client.js'

function createConfig(model: string) {
  return {
    llm: {
      baseUrl: 'http://localhost:8000',
      timeout: 12_000,
      model,
    },
  } as never
}

describe('per-model Responses API routing in createLLMClient', () => {
  it('flags Responses-API models', () => {
    expect(createLLMClient(createConfig('gpt-5.6-luna')).usesResponsesApi?.()).toBe(true)
    expect(createLLMClient(createConfig('openai/gpt-5.6-luna')).usesResponsesApi?.()).toBe(true)
  })

  it('keeps chat/completions for every other model', () => {
    expect(createLLMClient(createConfig('glm-5.3-flash')).usesResponsesApi?.()).toBe(false)
    expect(createLLMClient(createConfig('qwen3-32b')).usesResponsesApi?.()).toBe(false)
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
