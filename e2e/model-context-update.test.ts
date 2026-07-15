/**
 * Model Context Update E2E Tests
 *
 * Tests that updating a model's context window via REST API persists correctly.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createServerHandle } from '../src/server/index.js'
import { createProject, createSession, createTestProject, type TestProject } from './utils/index.js'
import { loadGlobalConfig, saveGlobalConfig, type GlobalConfig } from '../src/cli/config.js'
import type { Config } from '../src/shared/types.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'

describe('Model Context Update', () => {
  let server: Awaited<ReturnType<typeof createServerHandle>>
  let project: TestProject
  const testMode = 'test'
  const testProviderId = 'test-context-update-provider'
  const testModelId = 'test-context-update-model'
  let serverUrl: string
  let configPath: string

  beforeAll(async () => {
    // Use isolated config file to avoid races with parallel tests
    configPath = join(tmpdir(), `openfox-e2e-config-${randomUUID()}.json`)

    // Set up test provider in isolated config
    const globalConfig = await loadGlobalConfig(testMode, configPath)
    const customContextWindow = 200000

    const updatedConfig: GlobalConfig = {
      ...globalConfig,
      providers: [
        {
          id: testProviderId,
          name: 'Test Context Update Provider',
          url: 'http://localhost:11434',
          backend: 'ollama',
          models: [
            {
              id: testModelId,
              contextWindow: customContextWindow,
              source: 'user' as const,
            },
          ],
          isActive: true,
          createdAt: new Date().toISOString(),
        },
        ...(globalConfig.providers?.filter((p) => p.id !== testProviderId) ?? []),
      ],
      defaultModelSelection: `${testProviderId}/${testModelId}`,
      activeProviderId: testProviderId,
    }

    await saveGlobalConfig(testMode, updatedConfig, configPath)

    // Create server config
    const config: Config = {
      providers: updatedConfig.providers,
      defaultModelSelection: updatedConfig.defaultModelSelection,
      activeProviderId: updatedConfig.activeProviderId,
      globalConfigPath: configPath,
      llm: {
        baseUrl: 'http://localhost:11434/v1',
        model: testModelId,
        backend: 'ollama',
        timeout: 120000,
        idleTimeout: 300000,
        disableThinking: false,
      },
      context: { maxTokens: customContextWindow, compactionThreshold: 0.8, compactionTarget: 0.5 },
      agent: { maxIterations: 50, maxConsecutiveFailures: 3, toolTimeout: 120000 },
      server: { port: 0, host: '127.0.0.1', openBrowser: false },
      database: { path: '' },
      logging: { level: 'error' },
      mode: testMode,
      workdir: process.cwd(),
    }

    server = await createServerHandle(config)
    const { port } = await server.start(0)
    serverUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await server.close()
    // Clean up isolated config file
    await unlink(configPath).catch(() => {})
  })

  beforeEach(async () => {
    project = await createTestProject({ template: 'typescript' })
  })

  afterEach(async () => {
    await project.cleanup()
  })

  it('persists model context window update via PUT provider endpoint', async () => {
    const restProject = await createProject(serverUrl, { name: 'test', workdir: project.path })
    const restSession = await createSession(serverUrl, { projectId: restProject.id, title: 'Test session' })

    // Set session provider to match the one we'll edit
    await fetch(`${serverUrl}/api/sessions/${restSession.id}/provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: testProviderId, model: testModelId }),
    })

    const newContextWindow = 500000

    // Update model context via PUT provider endpoint (single save path)
    const response = await fetch(`${serverUrl}/api/providers/${testProviderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: [{ id: testModelId, contextWindow: newContextWindow }],
      }),
    })

    expect(response.ok).toBe(true)
    const responseBody = (await response.json()) as {
      success: boolean
      provider?: { models: Array<{ id: string; contextWindow: number }> }
    }

    // Verify the provider was updated
    expect(responseBody.success).toBe(true)
    expect(responseBody.provider).toBeDefined()
    const updatedModel = responseBody.provider!.models.find((m) => m.id === testModelId)
    expect(updatedModel).toBeDefined()
    expect(updatedModel!.contextWindow).toBe(newContextWindow)
  })
})
