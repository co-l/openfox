/**
 * Provider Plugin System E2E Tests
 *
 * Tests the full plugin lifecycle: loading, auth, transport, credential persistence.
 * Creates a mock plugin package dynamically before starting the server.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createTestServer, type TestServerHandle } from './utils/index.js'
import { loadGlobalConfig } from '../src/cli/config.js'

const PLUGIN_DIR = join(process.cwd(), 'e2e', '.openfox-test', 'plugins', 'mock-provider')

const MOCK_PACKAGE_JSON = JSON.stringify({
  name: '@openfox/mock-provider',
  version: '0.1.0',
  type: 'module',
  openfox: { apiVersion: 1, plugin: 'index.js' },
})

const MOCK_PLUGIN_CODE = `
let authCompletions = new Map()

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const authAdapter = {
  id: 'mock-auth',
  async beginLogin({ providerId }) {
    const completion = delay(50).then(() => {
      authCompletions.set(providerId, 'connected')
      return { credentialRef: 'mock-cred-' + providerId }
    })
    authCompletions.set(providerId, 'pending')
    return {
      challenge: {
        mode: 'device',
        verificationUrl: 'https://mock.example.com/device',
        userCode: 'MOCK-1234',
        instructions: 'Visit the URL and enter the code.',
      },
      completion,
    }
  },
  async getStatus({ providerId }) {
    const state = authCompletions.get(providerId) ?? 'disconnected'
    return { state }
  },
  async getAccessContext(_credentialRef) {
    return { accessToken: 'mock-access-token', headers: { Authorization: 'Bearer mock-access-token' } }
  },
  async logout(credentialRef) {
    for (const [key] of authCompletions) {
      if (key.includes(credentialRef.replace('mock-cred-', ''))) {
        authCompletions.delete(key)
      }
    }
  },
}

const transportAdapter = {
  id: 'mock-transport',
  async listModels(_context) {
    return [
      { id: 'mock-model-small', contextWindow: 128000, source: 'backend' },
      { id: 'mock-model-large', contextWindow: 1048576, source: 'backend' },
    ]
  },
  async complete(request, _context) {
    const content = typeof request.messages[0]?.content === 'string'
      ? 'mock echo: ' + request.messages[0].content
      : 'mock echo'
    return { content, usage: { promptTokens: 10, completionTokens: 5 } }
  },
  async *stream(request, _context) {
    const text = typeof request.messages[0]?.content === 'string'
      ? 'mock echo: ' + request.messages[0].content
      : 'mock echo'
    yield { type: 'delta', delta: text }
    yield { type: 'done', response: { content: text, usage: { promptTokens: 10, completionTokens: 5 } } }
  },
}

const preset = {
  id: 'mock-provider',
  name: 'Mock Provider',
  description: 'Mock provider plugin for E2E testing',
  requiresAuth: true,
  authAdapter: 'mock-auth',
  transportAdapter: 'mock-transport',
  defaults: { url: 'https://mock.example.com/v1', backend: 'openai' },
}

export function register(registry) {
  registry.registerAuth(authAdapter)
  registry.registerTransport(transportAdapter)
  registry.registerPreset(preset)
}
`

describe('Provider Plugin System', () => {
  let server: TestServerHandle

  beforeAll(async () => {
    await mkdir(PLUGIN_DIR, { recursive: true })
    await writeFile(join(PLUGIN_DIR, 'package.json'), MOCK_PACKAGE_JSON)
    await writeFile(join(PLUGIN_DIR, 'index.js'), MOCK_PLUGIN_CODE)
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
    await rm(PLUGIN_DIR, { recursive: true, force: true })
  })

  it('loads the mock plugin with correct metadata', async () => {
    const res = await fetch(`${server.url}/api/plugins`)
    const data = (await res.json()) as { plugins: Array<Record<string, unknown>> }
    const plugin = data.plugins.find((p) => p['packageName'] === '@openfox/mock-provider')
    expect(plugin).toBeDefined()
    expect(plugin!['loaded']).toBe(true)
    expect(plugin!['authAdapters']).toEqual(['mock-auth'])
    expect(plugin!['transportAdapters']).toEqual(['mock-transport'])
    expect(plugin!['presets']).toEqual(['mock-provider'])
  })

  it('serves the mock preset via provider-presets endpoint', async () => {
    const res = await fetch(`${server.url}/api/provider-presets`)
    const data = (await res.json()) as { presets: Array<Record<string, unknown>> }
    const preset = data.presets.find((p) => p['id'] === 'mock-provider')
    expect(preset).toBeDefined()
    expect(preset!['authAdapter']).toBe('mock-auth')
    expect(preset!['transportAdapter']).toBe('mock-transport')
    expect(preset!['requiresAuth']).toBe(true)
  })

  it('creates a provider from the mock preset', async () => {
    const res = await fetch(`${server.url}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E Mock Provider',
        url: 'https://mock.example.com/v1',
        backend: 'openai',
        authAdapter: 'mock-auth',
        transportAdapter: 'mock-transport',
        models: [],
      }),
    })
    expect(res.status).toBe(201)
    const data = (await res.json()) as { provider: Record<string, unknown> }
    expect(data.provider['authAdapter']).toBe('mock-auth')
    expect(data.provider['transportAdapter']).toBe('mock-transport')
  })

  it('completes the auth flow: login, status, logout', async () => {
    const createRes = await fetch(`${server.url}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Auth Test Provider',
        url: 'https://mock.example.com/v1',
        backend: 'openai',
        authAdapter: 'mock-auth',
        transportAdapter: 'mock-transport',
        models: [],
      }),
    })
    expect(createRes.status).toBe(201)
    const { provider } = (await createRes.json()) as { provider: { id: string } }
    const providerId = provider.id

    // Login
    const loginRes = await fetch(`${server.url}/api/provider-auth/${providerId}/login`, {
      method: 'POST',
    })
    const loginBody = (await loginRes.json()) as Record<string, unknown>
    expect(loginRes.status).toBe(200)
    expect(loginBody['verificationUrl']).toBe('https://mock.example.com/device')
    expect(loginBody['userCode']).toBe('MOCK-1234')

    // Poll status until connected (mock resolves after 50ms)
    let state = ''
    for (let i = 0; i < 20; i++) {
      const statusRes = await fetch(`${server.url}/api/provider-auth/${providerId}/status`)
      const statusBody = (await statusRes.json()) as Record<string, unknown>
      state = statusBody['state'] as string
      if (state === 'connected') break
      await new Promise((r) => setTimeout(r, 30))
    }
    expect(state).toBe('connected')

    // Logout
    const logoutRes = await fetch(`${server.url}/api/provider-auth/${providerId}/logout`, {
      method: 'POST',
    })
    expect(logoutRes.status).toBe(200)

    // Verify disconnected
    const statusAfterLogout = await fetch(`${server.url}/api/provider-auth/${providerId}/status`)
    const afterLogout = (await statusAfterLogout.json()) as Record<string, unknown>
    expect(afterLogout['state']).toBe('disconnected')
  })

  it('lists models via transport adapter', async () => {
    const createRes = await fetch(`${server.url}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Transport Test Provider',
        url: 'https://mock.example.com/v1',
        backend: 'openai',
        authAdapter: 'mock-auth',
        transportAdapter: 'mock-transport',
        models: [],
      }),
    })
    const { provider } = (await createRes.json()) as { provider: { id: string } }
    const providerId = provider.id

    // Activate the provider to trigger model fetch
    const activateRes = await fetch(`${server.url}/api/providers/${providerId}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(activateRes.status).toBe(200)

    // Activation triggers an async model fetch via the transport adapter, so poll
    // until the models land instead of racing the first response. Bounded by
    // time rather than attempts: on a loaded machine the fetch can take well
    // over the ~1 s that 50 quick attempts used to allow.
    let testProvider: { id: string; models: Array<{ id: string; contextWindow: number }> } | undefined
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const modelsRes = await fetch(`${server.url}/api/providers`)
      const providersData = (await modelsRes.json()) as {
        providers: Array<{ id: string; models: Array<{ id: string; contextWindow: number }> }>
      }
      testProvider = providersData.providers.find((p) => p.id === providerId)
      if (testProvider && testProvider.models.length >= 2) break
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(testProvider).toBeDefined()
    expect(testProvider!.models.length).toBeGreaterThanOrEqual(2)

    const modelIds = testProvider!.models.map((m) => m.id)
    expect(modelIds).toContain('mock-model-small')
    expect(modelIds).toContain('mock-model-large')

    const smallModel = testProvider!.models.find((m) => m.id === 'mock-model-small')
    expect(smallModel!.contextWindow).toBe(128000)
  })

  it('completes a request via transport adapter', async () => {
    const createRes = await fetch(`${server.url}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Completion Test Provider',
        url: 'https://mock.example.com/v1',
        backend: 'openai',
        authAdapter: 'mock-auth',
        transportAdapter: 'mock-transport',
        models: [{ id: 'mock-model-small', contextWindow: 128000 }],
      }),
    })
    const { provider } = (await createRes.json()) as { provider: { id: string } }

    // Activate
    await fetch(`${server.url}/api/providers/${provider.id}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    // Test completion via test-params endpoint
    const testRes = await fetch(`${server.url}/api/providers/test-params`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: provider.id,
        transportAdapter: 'mock-transport',
        url: 'https://mock.example.com/v1',
        model: 'mock-model-small',
        backend: 'openai',
        mode: 'non-thinking',
        modelConfig: { maxTokens: 100 },
      }),
    })
    expect(testRes.status).toBe(200)
    const result = (await testRes.json()) as { success: boolean; message: { content: string } }
    expect(result.success).toBe(true)
    expect(result.message.content).toContain('mock echo')
  })

  it('persists credentialRef in config after auth', async () => {
    const createRes = await fetch(`${server.url}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Persistence Test Provider',
        url: 'https://mock.example.com/v1',
        backend: 'openai',
        authAdapter: 'mock-auth',
        transportAdapter: 'mock-transport',
        models: [],
      }),
    })
    expect(createRes.status).toBe(201)
    const { provider } = (await createRes.json()) as { provider: { id: string } }

    // Complete auth
    const loginRes = await fetch(`${server.url}/api/provider-auth/${provider.id}/login`, {
      method: 'POST',
    })
    expect(loginRes.status).toBe(200)

    // Wait for completion
    let connected = false
    for (let i = 0; i < 20; i++) {
      const statusRes = await fetch(`${server.url}/api/provider-auth/${provider.id}/status`)
      const statusBody = (await statusRes.json()) as Record<string, unknown>
      if (statusBody['state'] === 'connected') {
        connected = true
        break
      }
      await new Promise((r) => setTimeout(r, 30))
    }
    expect(connected).toBe(true)

    // Allow the completion handler to persist credentialRef
    await new Promise((r) => setTimeout(r, 100))

    // Load config and verify credentialRef
    const config = await loadGlobalConfig('test', server.globalConfigPath)
    const savedProvider = config.providers.find((p) => p.id === provider.id)
    expect(savedProvider).toBeDefined()
    expect(savedProvider!.credentialRef).toBeDefined()
    expect(savedProvider!.credentialRef).toContain('mock-cred-')
    expect(savedProvider!.authAdapter).toBe('mock-auth')
  })
})
