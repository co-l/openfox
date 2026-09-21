import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js'

const mockResourceDiscovery = vi.hoisted(() => vi.fn())
const mockAuthServerDiscovery = vi.hoisted(() => vi.fn())
vi.mock('@modelcontextprotocol/sdk/client/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modelcontextprotocol/sdk/client/auth.js')>()
  return {
    ...actual,
    discoverOAuthProtectedResourceMetadata: mockResourceDiscovery,
    discoverAuthorizationServerMetadata: mockAuthServerDiscovery,
  }
})

import { McpOAuthProvider, buildOAuthProbeUrl, rejectStaleOAuthClient, resetProbeCache } from './oauth-provider.js'

const CLIENT = { client_id: 'client-1' } as OAuthClientInformationMixed

function probeProvider(client?: OAuthClientInformationMixed): McpOAuthProvider {
  const provider = McpOAuthProvider.forBackgroundProbe('supabase', 'https://supabase.example.com')
  if (client) void provider.saveClientInformation(client)
  return provider
}

function mockDiscovery() {
  mockResourceDiscovery.mockResolvedValue({ authorization_servers: ['https://as.example.com'] })
  mockAuthServerDiscovery.mockResolvedValue({ authorization_endpoint: 'https://as.example.com/authorize' })
}

function mockFetch(status: number, body = ''): typeof fetch {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch
}

describe('buildOAuthProbeUrl', () => {
  it('resolves the authorize endpoint and embeds the stored client_id', async () => {
    mockDiscovery()
    const url = await buildOAuthProbeUrl(probeProvider(CLIENT))

    expect(url?.href).toContain('https://as.example.com/authorize')
    expect(url?.searchParams.get('client_id')).toBe('client-1')
  })

  it('falls back to the resource URL when no authorization server is advertised', async () => {
    mockResourceDiscovery.mockResolvedValue({})
    mockAuthServerDiscovery.mockResolvedValue({ authorization_endpoint: 'https://supabase.example.com/authorize' })
    const url = await buildOAuthProbeUrl(probeProvider(CLIENT))

    expect(url?.href).toContain('https://supabase.example.com/authorize')
  })

  it('returns undefined when no client is stored', async () => {
    mockDiscovery()
    expect(await buildOAuthProbeUrl(probeProvider(undefined))).toBeUndefined()
  })

  it('returns undefined when discovery fails', async () => {
    mockResourceDiscovery.mockRejectedValue(new Error('boom'))
    expect(await buildOAuthProbeUrl(probeProvider(CLIENT))).toBeUndefined()
  })
})

describe('rejectStaleOAuthClient', () => {
  beforeEach(() => {
    resetProbeCache()
  })

  it('invalidates the stored client on a 401 from the authorize endpoint', async () => {
    mockDiscovery()
    const provider = probeProvider(CLIENT)
    await rejectStaleOAuthClient(provider, mockFetch(401))

    expect(await provider.clientInformation()).toBeUndefined()
  })

  it('invalidates the stored client on a 403 from the authorize endpoint', async () => {
    mockDiscovery()
    const provider = probeProvider(CLIENT)
    await rejectStaleOAuthClient(provider, mockFetch(403))

    expect(await provider.clientInformation()).toBeUndefined()
  })

  it('keeps the client on a 200 from the authorize endpoint', async () => {
    mockDiscovery()
    const provider = probeProvider(CLIENT)
    await rejectStaleOAuthClient(provider, mockFetch(200, '<html>login</html>'))

    expect(await provider.clientInformation()).toEqual(CLIENT)
  })

  it('treats a 400 whose body names an unrecognized client as stale', async () => {
    mockDiscovery()
    const provider = probeProvider(CLIENT)
    await rejectStaleOAuthClient(provider, mockFetch(400, '{"error_description":"Unrecognized client_id"}'))

    expect(await provider.clientInformation()).toBeUndefined()
  })

  it('ignores a generic 400 (missing params) as not stale', async () => {
    mockDiscovery()
    const provider = probeProvider(CLIENT)
    await rejectStaleOAuthClient(
      provider,
      mockFetch(400, '{"error":"invalid_request","error_description":"missing redirect_uri"}'),
    )

    expect(await provider.clientInformation()).toEqual(CLIENT)
  })

  it('does nothing when no client is stored', async () => {
    mockDiscovery()
    await expect(rejectStaleOAuthClient(probeProvider(undefined), mockFetch(401))).resolves.toBeUndefined()
  })

  it('does nothing when discovery fails', async () => {
    mockResourceDiscovery.mockRejectedValue(new Error('boom'))
    const provider = probeProvider(CLIENT)
    await rejectStaleOAuthClient(provider, mockFetch(401))

    expect(await provider.clientInformation()).toEqual(CLIENT)
  })

  it('does nothing when the probe fetch itself fails', async () => {
    mockDiscovery()
    const provider = probeProvider(CLIENT)
    await rejectStaleOAuthClient(
      provider,
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    expect(await provider.clientInformation()).toEqual(CLIENT)
  })

  it('caches the result so a repeat check does not re-probe', async () => {
    mockDiscovery()
    const provider = probeProvider(CLIENT)
    const fetchMock = mockFetch(200, '<html>login</html>')

    await rejectStaleOAuthClient(provider, fetchMock)
    await rejectStaleOAuthClient(provider, fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caches a stale verdict and keeps invalidating on repeat checks', async () => {
    mockDiscovery()
    const provider = probeProvider(CLIENT)
    const fetchMock = mockFetch(401)

    await rejectStaleOAuthClient(provider, fetchMock)
    expect(await provider.clientInformation()).toBeUndefined()

    // Re-save a client and re-check: the cached stale verdict must still burn it.
    await provider.saveClientInformation(CLIENT)
    await rejectStaleOAuthClient(provider, fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await provider.clientInformation()).toBeUndefined()
  })
})

describe('forBackgroundProbe storage isolation', () => {
  it('keeps probe credentials in memory, isolated from other probes', async () => {
    const a = McpOAuthProvider.forBackgroundProbe('server-a', 'https://a.example.com')
    const b = McpOAuthProvider.forBackgroundProbe('server-b', 'https://b.example.com')

    await a.saveClientInformation({ client_id: 'client-a' } as OAuthClientInformationMixed)
    await a.saveTokens({ access_token: 'tok-a', token_type: 'bearer' })

    expect(await a.clientInformation()).toEqual({ client_id: 'client-a' })
    expect(await a.tokens()).toEqual({ access_token: 'tok-a', token_type: 'bearer' })
    // A sibling probe must not see them.
    expect(await b.clientInformation()).toBeUndefined()
    expect(await b.tokens()).toBeUndefined()
  })
})
