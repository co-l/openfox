import express from 'express'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Config, Provider } from '../../shared/types.js'
import type { ProviderManager } from '../provider-manager.js'
import { ProviderRegistry } from '../providers/plugins/registry.js'
import { createProviderAuthRoutes } from './provider-auth.js'

const provider: Provider = {
  id: 'provider-1',
  name: 'External provider',
  url: 'https://provider.test',
  backend: 'openai',
  authAdapter: 'external-auth',
  transportAdapter: 'external-transport',
  models: [],
  isActive: true,
  createdAt: new Date().toISOString(),
}
const config = { server: { host: '127.0.0.1', port: 10369, openBrowser: false }, mode: 'test' } as Config
function manager(): ProviderManager {
  return {
    getProviders: () => [provider],
    setProviders: vi.fn(),
    createClient: vi.fn(),
    resolveModel: vi.fn(),
  } as unknown as ProviderManager
}

describe('provider auth routes', () => {
  const servers: ReturnType<typeof createServer>[] = []
  afterEach(async () =>
    Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))),
  )

  async function start(withAdapter: boolean | Record<string, unknown> = true) {
    const registry = new ProviderRegistry({ mode: 'production', configDirectory: '/tmp/openfox-test' })
    if (withAdapter)
      registry.registerAuth({
        id: 'external-auth',
        beginLogin: async () => ({
          challenge: {
            mode: 'device',
            verificationUrl: 'https://provider.test/device',
            userCode: 'ABCD',
            instructions: 'Enter code',
          },
          completion: new Promise(() => undefined),
        }),
        getStatus: async () => ({ state: 'disconnected' }),
        getAccessContext: async () => ({}),
        logout: async () => undefined,
        ...(typeof withAdapter === 'object' ? withAdapter : {}),
      } as never)
    const app = express()
    app.use(express.json())
    app.use('/api/provider-auth', createProviderAuthRoutes(config, manager(), registry))
    const server = createServer(app)
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  it('returns metadata-driven login challenges', async () => {
    const response = await fetch(`${await start()}/api/provider-auth/provider-1/login`, { method: 'POST' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      mode: 'device',
      verificationUrl: 'https://provider.test/device',
      userCode: 'ABCD',
    })
  })

  it('reports a missing plugin without changing provider configuration', async () => {
    const response = await fetch(`${await start(false)}/api/provider-auth/provider-1/login`, { method: 'POST' })
    expect(response.status).toBe(424)
    expect(await response.json()).toEqual({ error: 'Missing provider auth plugin: external-auth' })
  })

  it('deletes the accounts owned by the provider when it is disconnected', async () => {
    const deleteProvider = vi.fn(async () => undefined)
    const url = await start({ getStatus: async () => ({ state: 'connected' }), deleteProvider })

    const response = await fetch(`${url}/api/provider-auth/provider-1/logout`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(deleteProvider).toHaveBeenCalledWith('provider-1')
  })

  it('falls back to a single-credential logout when the adapter owns no per-provider accounts', async () => {
    const logout = vi.fn(async () => undefined)
    const url = await start({ logout })

    const response = await fetch(`${url}/api/provider-auth/provider-1/logout`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(logout).toHaveBeenCalledWith('provider-1')
  })
})
