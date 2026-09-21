// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from '../lib/api'
import { clearCache } from '../lib/resourceCache'
import { readProviders } from '../lib/resources'
import { useConfigStore } from './config'

vi.mock('../lib/api', () => ({
  authFetch: vi.fn(),
}))

const mockedAuthFetch = vi.mocked(authFetch)

function jsonResponse(data: unknown = {}, ok = true): Response {
  return { ok, json: () => Promise.resolve(data) } as Response
}

function seedProviders() {
  mockedAuthFetch.mockImplementation(async (url: string) => {
    if (url === '/api/providers') {
      return jsonResponse({
        providers: [
          {
            id: 'provider-1',
            name: 'OpenAI',
            url: 'https://api.openai.com/v1',
            backend: 'openai',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            models: [],
          },
        ],
        activeProviderId: 'provider-1',
      })
    }
    return jsonResponse({ success: true })
  })
}

describe('ConfigStore mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('fetchConfig loads both the config runtime and the providers list', async () => {
    mockedAuthFetch.mockImplementation(async (url: string) => {
      if (url === '/api/providers') return jsonResponse({ providers: [], activeProviderId: null })
      if (url === '/api/config') return jsonResponse({ version: '2.0.0', defaultModelSelection: 'p/m' })
      return jsonResponse({})
    })
    await useConfigStore.getState().fetchConfig()

    expect(mockedAuthFetch).toHaveBeenCalledWith('/api/config')
    expect(mockedAuthFetch).toHaveBeenCalledWith('/api/providers')
  })

  it('updateModelSettings PUTs then refreshes the providers list', async () => {
    seedProviders()
    const ok = await useConfigStore.getState().updateModelSettings('provider-1', 'gpt-4', {
      thinkingLevel: 'high',
      thinkingEnabled: true,
    })
    expect(ok).toBe(true)
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(
      1,
      '/api/providers/provider-1/models/gpt-4/settings',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ thinkingLevel: 'high', thinkingEnabled: true }),
      }),
    )
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(2, '/api/providers')
  })

  it('activateProvider POSTs then refreshes providers and config', async () => {
    seedProviders()
    const ok = await useConfigStore.getState().activateProvider('provider-1')
    expect(ok).toBe(true)
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(
      1,
      '/api/providers/provider-1/activate',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(2, '/api/providers')
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(3, '/api/config')
  })

  it('setDefaultModel POSTs then refreshes providers and config', async () => {
    seedProviders()
    const ok = await useConfigStore.getState().setDefaultModel('provider-1', 'gpt-4')
    expect(ok).toBe(true)
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(
      1,
      '/api/default-model',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ providerId: 'provider-1', model: 'gpt-4' }) }),
    )
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(2, '/api/config')
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(3, '/api/providers')
  })

  it('refreshProviderModels refreshes only the targeted provider models plus the list', async () => {
    seedProviders()
    const ok = await useConfigStore.getState().refreshProviderModels('provider-1')
    expect(ok).toBe(true)
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(
      1,
      '/api/providers/provider-1/refresh',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(2, '/api/providers/provider-1/models')
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(3, '/api/providers')
    expect(readProviders()?.activeProviderId).toBe('provider-1')
  })
})
