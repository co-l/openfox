import { describe, expect, it, vi } from 'vitest'
import { ProviderAdapterRegistry } from './registry.js'
import type { ProviderAuthAdapter, ProviderTransportAdapter } from './types.js'

function authAdapter(id: string): ProviderAuthAdapter {
  return {
    id,
    getStatus: vi.fn(async () => ({ state: 'connected' as const })),
    beginLogin: vi.fn(async () => ({
      url: 'https://example.test/login',
      instructions: 'Sign in',
      mode: 'browser' as const,
    })),
    getAccessContext: vi.fn(async () => ({ accessToken: 'secret' })),
    logout: vi.fn(async () => undefined),
  }
}

function transportAdapter(id: string): ProviderTransportAdapter {
  return {
    id,
    listModels: vi.fn(async () => []),
    complete: vi.fn(async () => ({
      id: 'response-1',
      content: 'ok',
      finishReason: 'stop' as const,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })),
    async *stream() {
      yield { type: 'text_delta' as const, content: 'ok' }
    },
  }
}

describe('ProviderAdapterRegistry', () => {
  it('registers and resolves auth and transport adapters independently', () => {
    const registry = new ProviderAdapterRegistry()
    const auth = authAdapter('oauth')
    const transport = transportAdapter('codex')

    registry.registerAuth(auth)
    registry.registerTransport(transport)

    expect(registry.getAuth('oauth')).toBe(auth)
    expect(registry.getTransport('codex')).toBe(transport)
    expect(registry.getAuth()).toBeUndefined()
  })

  it('rejects duplicate adapter ids within the same adapter kind', () => {
    const registry = new ProviderAdapterRegistry()
    registry.registerAuth(authAdapter('oauth'))

    expect(() => registry.registerAuth(authAdapter('oauth'))).toThrow('Provider auth adapter already registered: oauth')
  })

  it('allows the same id for auth and transport namespaces', () => {
    const registry = new ProviderAdapterRegistry()

    registry.registerAuth(authAdapter('openai-account'))
    registry.registerTransport(transportAdapter('openai-account'))

    expect(registry.getAuth('openai-account')).toBeDefined()
    expect(registry.getTransport('openai-account')).toBeDefined()
  })
})
