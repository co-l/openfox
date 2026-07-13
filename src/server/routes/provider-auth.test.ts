import express from 'express'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Config, Provider } from '../../shared/types.js'
import type { ProviderManager } from '../provider-manager.js'
import { MemoryProviderCredentialStore } from '../providers/adapters/credential-store.js'
import { OpenAIBrowserAuthAdapter } from '../providers/adapters/openai-browser-auth.js'
import { createProviderAuthRoutes } from './provider-auth.js'

const provider: Provider = {
  id: 'provider-1',
  name: 'OpenAI account',
  url: 'https://chatgpt.com/backend-api/codex',
  backend: 'openai',
  authAdapter: 'openai-account',
  models: [],
  isActive: true,
  createdAt: new Date().toISOString(),
}

const config = {
  server: { host: '127.0.0.1', port: 10369, openBrowser: false },
  mode: 'test',
} as Config

function manager(): ProviderManager {
  return {
    getProviders: () => [provider],
    getActiveProvider: () => provider,
    getActiveProviderId: () => provider.id,
    getCurrentModel: () => undefined,
    getCurrentModelContext: () => 0,
    getLLMClient: vi.fn(),
    activateProvider: vi.fn(),
    addProvider: vi.fn(),
    removeProvider: vi.fn(),
    setProviders: vi.fn(),
    getProviderStatus: vi.fn(),
    getProviderModels: vi.fn(),
    setDefaultModelSelection: vi.fn(),
    updateModelContext: vi.fn(),
    updateModelSettings: vi.fn(),
    refreshProviderModels: vi.fn(),
    getModelSettings: vi.fn(),
  } as unknown as ProviderManager
}

describe('provider auth routes', () => {
  const servers: ReturnType<typeof createServer>[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  })

  async function start() {
    const request = vi.fn(async (url: string | URL | Request) => {
      const value = String(url)
      if (value.endsWith('/api/accounts/deviceauth/usercode')) {
        return new Response(JSON.stringify({ device_auth_id: 'device-1', user_code: 'ABCD-EFGH', interval: '1' }), {
          status: 200,
        })
      }
      if (value.endsWith('/api/accounts/deviceauth/token')) {
        return new Response(JSON.stringify({ authorization_code: 'code-1', code_verifier: 'verifier-1' }), {
          status: 200,
        })
      }
      if (value.endsWith('/oauth/token')) {
        return new Response(
          JSON.stringify({ access_token: 'header.payload.signature', refresh_token: 'refresh-1', expires_in: 3600 }),
          { status: 200 },
        )
      }
      return new Response(null, { status: 404 })
    })
    const auth = new OpenAIBrowserAuthAdapter(new MemoryProviderCredentialStore(), {
      issuer: 'https://issuer.test',
      clientId: 'client-1',
      fetch: request as typeof fetch,
    })
    const app = express()
    app.use(express.json())
    app.use('/api/provider-auth', createProviderAuthRoutes(config, manager(), auth))
    const server = createServer(app)
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    return `http://127.0.0.1:${port}`
  }

  it('returns a browser challenge for a configured provider', async () => {
    const baseUrl = await start()
    const response = await fetch(`${baseUrl}/api/provider-auth/provider-1/login`, { method: 'POST' })
    const body = (await response.json()) as { url: string; mode: string; userCode: string }

    expect(response.status).toBe(200)
    expect(body.mode).toBe('browser')
    expect(body.url).toBe('https://issuer.test/codex/device')
    expect(body.userCode).toBe('ABCD-EFGH')
  })

  it('returns disconnected status before login', async () => {
    const baseUrl = await start()
    const response = await fetch(`${baseUrl}/api/provider-auth/provider-1/status`)
    expect(await response.json()).toEqual({ state: 'disconnected' })
  })

  it('rejects callbacks missing code or state', async () => {
    const baseUrl = await start()
    const response = await fetch(`${baseUrl}/api/provider-auth/openai/callback`)
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Missing OAuth code or state')
  })
})
