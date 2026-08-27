import { describe, expect, it } from 'vitest'
import { isResponsesApiModel, resolveApiProtocol } from './responses-routing.js'

describe('resolveApiProtocol', () => {
  it('routes OpenCode Go Responses-API models to the responses protocol', () => {
    expect(resolveApiProtocol('gpt-5.6-luna')).toBe('responses')
    expect(resolveApiProtocol('grok-4.6')).toBe('responses')
    expect(resolveApiProtocol('muse-spark-1.2-contributor')).toBe('responses')
  })

  it('routes chat/completions models to the default protocol', () => {
    expect(resolveApiProtocol('glm-5.3-flash')).toBe('chat-completions')
    expect(resolveApiProtocol('glm-5.3')).toBe('chat-completions')
    expect(resolveApiProtocol('kimi-k3')).toBe('chat-completions')
    expect(resolveApiProtocol('kimi-k2.7-code')).toBe('chat-completions')
    expect(resolveApiProtocol('deepseek-v4-pro')).toBe('chat-completions')
    expect(resolveApiProtocol('minimax-m3')).toBe('chat-completions')
    expect(resolveApiProtocol('qwen3.8-max')).toBe('chat-completions')
    expect(resolveApiProtocol('hy3')).toBe('chat-completions')
    expect(resolveApiProtocol('qwen3-32b')).toBe('chat-completions')
  })

  it('matches org-prefixed model ids on their last path segment', () => {
    expect(resolveApiProtocol('openai/gpt-5.6-luna')).toBe('responses')
    expect(resolveApiProtocol('x-ai/grok-4.6')).toBe('responses')
    expect(resolveApiProtocol('zai-org/glm-5.3-flash')).toBe('chat-completions')
  })

  it('matches case-insensitively', () => {
    expect(resolveApiProtocol('GPT-5.6-Luna')).toBe('responses')
    expect(resolveApiProtocol('Grok-4.6')).toBe('responses')
  })

  it('does not match ids that merely contain a routed id as a prefix', () => {
    expect(resolveApiProtocol('gpt-5.6-luna-experimental')).toBe('chat-completions')
    expect(resolveApiProtocol('grok-4.6-turbo')).toBe('chat-completions')
  })
})

describe('isResponsesApiModel', () => {
  it('returns true only for Responses-API models', () => {
    expect(isResponsesApiModel('gpt-5.6-luna')).toBe(true)
    expect(isResponsesApiModel('glm-5.3-flash')).toBe(false)
    expect(isResponsesApiModel('')).toBe(false)
  })
})
