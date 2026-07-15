/**
 * Config Reload After Provider Update E2E Test
 *
 * Tests that /api/config returns updated data after provider operations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { unlinkSync } from 'node:fs'
import { createTestServer, type TestServerHandle } from './utils/index.js'
import { getGlobalConfigPath } from '../src/cli/paths.js'

describe('Config reload after provider update', () => {
  let server: TestServerHandle

  beforeAll(async () => {
    // Clean any leftover config from previous test runs
    try {
      unlinkSync(getGlobalConfigPath('test'))
    } catch {
      /* ok */
    }
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  it('config-reflects-provider-creation: /api/config returns updated providers after POST /api/providers', async () => {
    // Create a new provider via the onboarding endpoint
    const createRes = await fetch(`${server.url}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Config Reload Provider',
        url: 'http://localhost:8000',
        backend: 'vllm',
        model: 'test-model',
      }),
    })

    expect(createRes.status).toBe(201)
    const createData = (await createRes.json()) as { success: boolean; provider: { id: string; name: string } }
    expect(createData.success).toBe(true)
    expect(createData.provider.name).toBe('Test Config Reload Provider')

    // Immediately fetch config again - should reflect the new provider
    const updatedRes = await fetch(`${server.url}/api/config`)
    expect(updatedRes.status).toBe(200)
    const updatedConfig = (await updatedRes.json()) as { providers: Array<{ id: string; name: string }> }

    // The new provider should be in the config - THIS IS THE KEY TEST
    const foundProvider = updatedConfig.providers.find((p) => p.id === createData.provider.id)
    expect(foundProvider).toBeDefined()
    expect(foundProvider?.name).toBe('Test Config Reload Provider')
  })

  it('config-reflects-provider-activation: /api/config returns updated activeProviderId after activate', async () => {
    // Get current active provider
    const initialConfigRes = await fetch(`${server.url}/api/config`)
    const initialConfig = (await initialConfigRes.json()) as { activeProviderId: string | null }

    // Create a second provider to activate
    const createRes = await fetch(`${server.url}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Activation Test Provider',
        url: 'http://localhost:8001',
        backend: 'vllm',
        model: 'activation-test-model',
      }),
    })
    expect(createRes.status).toBe(201)
    const createData = (await createRes.json()) as { success: boolean; provider: { id: string; name: string } }

    // Activate the newly created provider
    const activateRes = await fetch(`${server.url}/api/providers/${createData.provider.id}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(activateRes.status).toBe(200)

    // Fetch config again - should reflect the new active provider
    const updatedRes = await fetch(`${server.url}/api/config`)
    const updatedConfig = (await updatedRes.json()) as { activeProviderId: string | null }

    // Active provider should have changed to the newly created one
    expect(updatedConfig.activeProviderId).toBe(createData.provider.id)
    expect(updatedConfig.activeProviderId).not.toBe(initialConfig.activeProviderId)
  })
})
