import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
}))

vi.mock('../db/settings.js', () => ({
  getSetting: mockGetSetting,
  SETTINGS_KEYS: { PROXY_URL: 'network.proxyUrl' },
}))

interface MockProxyAgentInstance {
  destroy: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

const { mockUndiciFetch, mockProxyAgentInstances, mockProxyAgentCtor } = vi.hoisted(() => {
  const instances: MockProxyAgentInstance[] = []
  return {
    mockUndiciFetch: vi.fn(),
    mockProxyAgentInstances: instances,
    mockProxyAgentCtor: vi.fn(),
  }
})

vi.mock('undici', () => {
  function MockProxyAgent(this: MockProxyAgentInstance, opts: unknown) {
    this.destroy = vi.fn().mockResolvedValue(undefined)
    this.close = vi.fn().mockResolvedValue(undefined)
    mockProxyAgentInstances.push(this)
    mockProxyAgentCtor(opts)
  }
  return {
    fetch: mockUndiciFetch,
    ProxyAgent: MockProxyAgent as unknown as typeof import('undici').ProxyAgent,
  }
})

import { __resetProxyCache } from './proxy.js'

describe('global fetch override', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProxyAgentInstances.length = 0
    __resetProxyCache()
  })

  it('calls native fetch when no proxy is configured', async () => {
    mockGetSetting.mockReturnValue(null)

    const result = await fetch('http://example.com')

    expect(result).toBeInstanceOf(Response)
    expect(mockUndiciFetch).not.toHaveBeenCalled()
  })

  it('calls native fetch when proxy URL is empty string', async () => {
    mockGetSetting.mockReturnValue('')

    const result = await fetch('http://example.com')

    expect(result).toBeInstanceOf(Response)
    expect(mockUndiciFetch).not.toHaveBeenCalled()
  })

  it('uses undici fetch with ProxyAgent when proxy is configured', async () => {
    mockGetSetting.mockReturnValue('http://proxy:8080')
    const mockResponse = new Response('proxied')
    mockUndiciFetch.mockResolvedValue(mockResponse)

    const result = await fetch('http://example.com')

    expect(result).toBe(mockResponse)
    expect(mockUndiciFetch).toHaveBeenCalledTimes(1)
    expect(mockUndiciFetch).toHaveBeenCalledWith(
      'http://example.com',
      expect.objectContaining({ dispatcher: expect.anything() }),
    )
    expect(mockProxyAgentCtor).toHaveBeenCalledWith(expect.objectContaining({ uri: 'http://proxy:8080' }))
  })

  it('passes options through to undici fetch when using proxy', async () => {
    mockGetSetting.mockReturnValue('http://proxy:8080')
    const mockResponse = new Response('proxied')
    mockUndiciFetch.mockResolvedValue(mockResponse)
    const abortController = new AbortController()

    await fetch('http://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
      signal: abortController.signal,
    })

    expect(mockUndiciFetch).toHaveBeenCalledWith(
      'http://example.com',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
        signal: abortController.signal,
        dispatcher: expect.anything(),
      }),
    )
  })

  it('reuses cached proxy agent for the same URL', async () => {
    mockGetSetting.mockReturnValue('http://proxy:8080')
    mockUndiciFetch.mockResolvedValue(new Response('ok'))

    await fetch('http://example.com/1')
    await fetch('http://example.com/2')

    expect(mockProxyAgentCtor).toHaveBeenCalledTimes(1)
    expect(mockUndiciFetch).toHaveBeenCalledTimes(2)
  })

  it('creates new agent and destroys old one when proxy URL changes', async () => {
    mockGetSetting.mockReturnValue('http://proxy-old:8080')
    mockUndiciFetch.mockResolvedValue(new Response('ok'))
    await fetch('http://example.com')
    expect(mockProxyAgentCtor).toHaveBeenCalledTimes(1)
    const oldAgent = mockProxyAgentInstances[0]

    mockGetSetting.mockReturnValue('http://proxy-new:8080')
    await fetch('http://example.com')

    expect(mockProxyAgentCtor).toHaveBeenCalledTimes(2)
    expect(oldAgent!.destroy).toHaveBeenCalledTimes(1)
    expect(mockProxyAgentCtor).toHaveBeenLastCalledWith(expect.objectContaining({ uri: 'http://proxy-new:8080' }))
  })

  it('destroys old agent when proxy is cleared', async () => {
    mockGetSetting.mockReturnValue('http://proxy:8080')
    mockUndiciFetch.mockResolvedValue(new Response('ok'))
    await fetch('http://example.com')
    const oldAgent = mockProxyAgentInstances[0]
    expect(oldAgent).toBeDefined()

    mockGetSetting.mockReturnValue(null)
    await fetch('http://example.com')

    expect(oldAgent!.destroy).toHaveBeenCalledTimes(1)
  })

  it('calls native fetch after proxy is cleared', async () => {
    mockGetSetting.mockReturnValue('http://proxy:8080')
    mockUndiciFetch.mockResolvedValue(new Response('proxied'))
    await fetch('http://example.com')
    expect(mockUndiciFetch).toHaveBeenCalledTimes(1)

    mockGetSetting.mockReturnValue(null)
    const result = await fetch('http://example.com')

    expect(result).toBeInstanceOf(Response)
    expect(mockUndiciFetch).toHaveBeenCalledTimes(1)
  })

  it('does not validate TLS strictly (rejectUnauthorized: false)', async () => {
    mockGetSetting.mockReturnValue('https://proxy:8443')
    mockUndiciFetch.mockResolvedValue(new Response('secure'))

    await fetch('https://api.example.com')

    expect(mockProxyAgentCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: 'https://proxy:8443',
        requestTls: { rejectUnauthorized: false },
      }),
    )
  })
})
