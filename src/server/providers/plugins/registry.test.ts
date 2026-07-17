import { describe, expect, it } from 'vitest'
import { ProviderRegistry } from './registry.js'

function registry() {
  return new ProviderRegistry({ mode: 'production', configDirectory: '/tmp/openfox' })
}

describe('ProviderRegistry', () => {
  it('registers generic auth, transport, and preset entries', () => {
    const value = registry()
    value.registerAuth({
      id: 'auth',
      beginLogin: async () => ({
        challenge: { mode: 'external', verificationUrl: 'https://example.test', instructions: 'Continue' },
        completion: Promise.resolve({ credentialRef: 'ref' }),
      }),
      getStatus: async () => ({ state: 'connected' }),
      getAccessContext: async () => ({}),
      logout: async () => undefined,
    })
    value.registerTransport({
      id: 'transport',
      listModels: async () => [],
      complete: async () => ({
        id: '1',
        content: '',
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }),
      stream: async function* () {},
    })
    value.registerPreset({
      id: 'preset',
      name: 'Preset',
      description: 'Test',
      requiresAuth: true,
      authAdapter: 'auth',
      transportAdapter: 'transport',
      defaults: { url: 'https://example.test', backend: 'openai' },
    })
    expect(value.getAuth('auth')?.id).toBe('auth')
    expect(value.getTransport('transport')?.id).toBe('transport')
    expect(value.getPresets()).toHaveLength(1)
  })

  it('overwrites on duplicate auth adapter', () => {
    const value = registry()
    const adapter = {
      id: 'auth',
      beginLogin: async () => ({
        challenge: { mode: 'external' as const, verificationUrl: 'https://example.test', instructions: 'Continue' },
        completion: Promise.resolve({ credentialRef: 'ref' }),
      }),
      getStatus: async () => ({ state: 'connected' as const }),
      getAccessContext: async () => ({}),
      logout: async () => undefined,
    }
    value.registerAuth(adapter)
    value.registerAuth(adapter)
    expect(value.listAuthAdapters()).toHaveLength(1)
  })

  it('lists registered auth and transport adapters', () => {
    const value = registry()
    value.registerAuth({
      id: 'auth-a',
      beginLogin: async () => ({
        challenge: { mode: 'external' as const, verificationUrl: 'https://example.test', instructions: 'Continue' },
        completion: Promise.resolve({ credentialRef: 'ref' }),
      }),
      getStatus: async () => ({ state: 'connected' as const }),
      getAccessContext: async () => ({}),
      logout: async () => undefined,
    })
    value.registerAuth({
      id: 'auth-b',
      beginLogin: async () => ({
        challenge: { mode: 'external' as const, verificationUrl: 'https://example.test', instructions: 'Continue' },
        completion: Promise.resolve({ credentialRef: 'ref' }),
      }),
      getStatus: async () => ({ state: 'connected' as const }),
      getAccessContext: async () => ({}),
      logout: async () => undefined,
    })
    value.registerTransport({
      id: 'transport-a',
      listModels: async () => [],
      complete: async () => ({
        id: '1',
        content: '',
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }),
      stream: async function* () {},
    })

    expect(value.listAuthAdapters()).toEqual([{ id: 'auth-a' }, { id: 'auth-b' }])
    expect(value.listTransportAdapters()).toEqual([{ id: 'transport-a' }])
  })

  it('returns empty arrays when nothing registered', () => {
    const value = registry()
    expect(value.listAuthAdapters()).toEqual([])
    expect(value.listTransportAdapters()).toEqual([])
  })

  it('registers presets accessible via getPresets', () => {
    const value = registry()
    value.registerPreset({
      id: 'preset-1',
      name: 'External Provider',
      description: 'External Account Provider',
      requiresAuth: true,
      authAdapter: 'auth-a',
      transportAdapter: 'transport-a',
      defaults: { url: 'https://provider.example/v1', backend: 'openai' },
    })
    expect(value.getPresets()).toHaveLength(1)
    expect(value.getPresets()[0]!.id).toBe('preset-1')
  })

  it('overwrites on duplicate preset registration', () => {
    const value = registry()
    const preset = {
      id: 'dup',
      name: 'Dup',
      description: 'Dup',
      requiresAuth: false,
      defaults: { url: 'https://example.test', backend: 'openai' },
    }
    value.registerPreset(preset)
    value.registerPreset(preset)
    expect(value.getPresets()).toHaveLength(1)
  })

  it('rejects empty ID strings', () => {
    const value = registry()
    expect(() =>
      value.registerAuth({
        id: ' ',
        beginLogin: async () => ({
          challenge: { mode: 'external' as const, verificationUrl: 'https://example.test', instructions: 'Continue' },
          completion: Promise.resolve({ credentialRef: 'ref' }),
        }),
        getStatus: async () => ({ state: 'connected' as const }),
        getAccessContext: async () => ({}),
        logout: async () => undefined,
      }),
    ).toThrow('cannot be empty')
  })

  it('hydrates a concise provider reference from its preset', () => {
    const value = registry()
    value.registerPreset({
      id: 'example',
      name: 'Example Provider',
      description: 'Example',
      requiresAuth: true,
      authAdapter: 'example-auth',
      transportAdapter: 'example-transport',
      defaults: { name: 'Example Default', url: 'https://example.test/v1', backend: 'openai' },
    })

    expect(
      value.resolveProvider({
        id: 'main',
        preset: 'example',
        name: 'main',
        url: '',
        backend: 'unknown',
        models: [],
        isActive: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatchObject({
      id: 'main',
      preset: 'example',
      name: 'Example Default',
      url: 'https://example.test/v1',
      backend: 'openai',
      authAdapter: 'example-auth',
      transportAdapter: 'example-transport',
      models: [],
    })
  })

  it('keeps explicit provider overrides over preset defaults', () => {
    const value = registry()
    value.registerPreset({
      id: 'example',
      name: 'Example Provider',
      description: 'Example',
      requiresAuth: false,
      defaults: { url: 'https://example.test/v1', backend: 'openai' },
    })

    expect(
      value.resolveProvider({
        id: 'main',
        preset: 'example',
        name: 'Custom',
        url: 'http://localhost:9000',
        backend: 'vllm',
        models: [{ id: 'custom-model', contextWindow: 4096, source: 'user' }],
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatchObject({
      name: 'Custom',
      url: 'http://localhost:9000',
      backend: 'vllm',
      models: [{ id: 'custom-model' }],
    })
  })
})
