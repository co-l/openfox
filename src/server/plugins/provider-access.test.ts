import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPluginProviderAccess, resolveEndpoint } from './provider-access.js'
import type { Provider } from '../../shared/types.js'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'openrouter-1',
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1',
    backend: 'openai',
    apiKey: 'sk-or-secret',
    models: [{ id: 'nace-ai/drex-v2.0' } as Provider['models'][number]],
    isActive: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Provider
}

const fetchMock = vi.fn()

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function stubFetch(response: { status?: number; body?: string }) {
  fetchMock.mockResolvedValue({
    ok: (response.status ?? 200) < 400,
    status: response.status ?? 200,
    text: async () => response.body ?? '{}',
  })
  vi.stubGlobal('fetch', fetchMock)
}

describe('resolveEndpoint (verified mappings only)', () => {
  it('maps OpenRouter origin to the decisions endpoint', () => {
    expect(resolveEndpoint('https://openrouter.ai/api/v1', 'decisions')).toBe(
      'https://openrouter.ai/api/alpha/decisions',
    )
  })

  it('maps DeepInfra origin to the decisions endpoint', () => {
    expect(resolveEndpoint('https://api.deepinfra.com/v1/openai', 'decisions')).toBe(
      'https://api.deepinfra.com/v1/decisions',
    )
  })

  it('maps loopback origins to the local systemone route', () => {
    expect(resolveEndpoint('http://127.0.0.1:8765', 'systemone')).toBe('http://127.0.0.1:8765/v1/systemone')
    expect(resolveEndpoint('http://localhost:8765/v1', 'systemone')).toBe('http://localhost:8765/v1/systemone')
  })

  it('rejects unknown remote origins (no blind path appending)', () => {
    expect(() => resolveEndpoint('https://evil.example.com/v1', 'decisions')).toThrow(/No verified endpoint mapping/)
  })

  it('rejects non-loopback HTTP origins', () => {
    expect(() => resolveEndpoint('http://plain.example.com', 'decisions')).toThrow(/must use HTTPS/)
  })

  it('rejects invalid URLs', () => {
    expect(() => resolveEndpoint('not-a-url', 'decisions')).toThrow(/not a valid URL/)
  })
})

describe('createPluginProviderAccess', () => {
  it('lists providers without credential material', () => {
    const access = createPluginProviderAccess({ getProviders: () => [makeProvider()] })
    const list = access.listProviders()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: 'openrouter-1',
      name: 'OpenRouter',
      backend: 'openai',
      isActive: true,
      hasCredential: true,
      models: ['nace-ai/drex-v2.0'],
    })
    expect(JSON.stringify(list)).not.toContain('sk-or-secret')
  })

  it('reuses legacy apiKey credentials for the verified decisions endpoint', async () => {
    stubFetch({ body: '{"answers":{}}' })
    const access = createPluginProviderAccess({ getProviders: () => [makeProvider()] })
    const result = await access.requestJson('openrouter-1', 'decisions', { model: 'x' })
    expect(result).toEqual({ answers: {} })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-or-secret')
    expect(init.redirect).toBe('error')
  })

  it('resolves credentialRef credentials through the auth adapter', async () => {
    stubFetch({ body: '{"ok":true}' })
    const getAccessContext = vi.fn().mockResolvedValue({ accessToken: 'adapter-token' })
    const access = createPluginProviderAccess({
      getProviders: () => [makeProvider({ id: 'p1', apiKey: undefined, credentialRef: 'ref-1', authAdapter: 'oauth' })],
      getAuth: (id) => (id === 'oauth' ? ({ getAccessContext } as never) : undefined),
    })
    await access.requestJson('p1', 'decisions', {})
    expect(getAccessContext).toHaveBeenCalledWith('ref-1')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer adapter-token')
  })

  it('fails when the auth adapter is missing', async () => {
    const access = createPluginProviderAccess({
      getProviders: () => [makeProvider({ apiKey: undefined, credentialRef: 'ref-1', authAdapter: 'gone' })],
      getAuth: () => undefined,
    })
    await expect(access.requestJson('openrouter-1', 'decisions', {})).rejects.toThrow(/auth adapter is unavailable/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails when credentials are missing', async () => {
    const access = createPluginProviderAccess({
      getProviders: () => [makeProvider({ apiKey: undefined })],
    })
    await expect(access.requestJson('openrouter-1', 'decisions', {})).rejects.toThrow(/no configured credentials/)
  })

  it('fails for a removed provider', async () => {
    const access = createPluginProviderAccess({ getProviders: () => [] })
    await expect(access.requestJson('gone', 'decisions', {})).rejects.toThrow(/Provider not found/)
  })

  it('consults an inactive provider — isActive only marks chat selection, plugin selection is explicit consent', async () => {
    stubFetch({ body: '{"answers":{}}' })
    const access = createPluginProviderAccess({
      getProviders: () => [makeProvider({ isActive: false })],
    })
    const result = await access.requestJson('openrouter-1', 'decisions', { model: 'x' })
    expect(result).toEqual({ answers: {} })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-or-secret')
  })

  it('never sends credentials to an unmapped origin (URL changed)', async () => {
    stubFetch({ body: '{}' })
    const access = createPluginProviderAccess({
      getProviders: () => [makeProvider({ url: 'https://attacker.example.com/v1' })],
    })
    await expect(access.requestJson('openrouter-1', 'decisions', {})).rejects.toThrow(/No verified endpoint mapping/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws on HTTP error responses without echoing the body', async () => {
    stubFetch({ status: 401, body: '{"error":"sk-or-secret leaked"}' })
    const access = createPluginProviderAccess({ getProviders: () => [makeProvider()] })
    await expect(access.requestJson('openrouter-1', 'decisions', {})).rejects.toThrow(/status 401/)
  })

  it('throws on invalid JSON responses', async () => {
    stubFetch({ body: 'not json' })
    const access = createPluginProviderAccess({ getProviders: () => [makeProvider()] })
    await expect(access.requestJson('openrouter-1', 'decisions', {})).rejects.toThrow(/invalid JSON/)
  })

  it('supports local systemone endpoints without credentials', async () => {
    stubFetch({ body: '{"answers":{}}' })
    const access = createPluginProviderAccess({
      getProviders: () => [
        makeProvider({
          id: 'jev-local',
          name: 'Jev-Style',
          url: 'http://127.0.0.1:8765',
          apiKey: undefined,
          isLocal: true,
        }),
      ],
    })
    const result = await access.requestJson('jev-local', 'systemone', { questions: {} })
    expect(result).toEqual({ answers: {} })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8765/v1/systemone')
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined()
  })

  it('enforces a strict timeout via AbortSignal', async () => {
    stubFetch({ body: '{}' })
    const access = createPluginProviderAccess({ getProviders: () => [makeProvider()] })
    await access.requestJson('openrouter-1', 'decisions', {}, { timeoutMs: 5000 })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('honors a caller cancellation signal', async () => {
    stubFetch({ body: '{}' })
    const access = createPluginProviderAccess({ getProviders: () => [makeProvider()] })
    const controller = new AbortController()
    controller.abort()
    await access.requestJson('openrouter-1', 'decisions', {}, { signal: controller.signal })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.signal as AbortSignal).aborted).toBe(true)
    expect((init.signal as AbortSignal).reason).toBeInstanceOf(DOMException)
  })
})
