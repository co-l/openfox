/**
 * Model Context Update E2E Tests
 *
 * Tests that updating a model's context window via REST API returns contextState
 * so the frontend can update the session header immediately.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createServerHandle } from '../src/server/index.js'
import { createProject, createSession, createTestProject, type TestProject } from './utils/index.js'
import { loadGlobalConfig, saveGlobalConfig, type GlobalConfig } from '../src/cli/config.js'
import type { Config } from '../src/shared/types.js'

describe('Model Context Update', () => {
  let server: Awaited<ReturnType<typeof createServerHandle>>
  let project: TestProject
  const testMode = 'test'
  const testProviderId = 'test-context-update-provider'
  const testModelId = 'test-context-update-model'
  let serverUrl: string

  beforeAll(async () => {
    // Set up test provider in config
    const globalConfig = await loadGlobalConfig(testMode)
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

    await saveGlobalConfig(testMode, updatedConfig)

    // Create server config
    const config: Config = {
      providers: updatedConfig.providers,
      defaultModelSelection: updatedConfig.defaultModelSelection,
      activeProviderId: updatedConfig.activeProviderId,
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
      server: { port: 10998, host: '127.0.0.1', openBrowser: false },
      database: { path: '' },
      logging: { level: 'error' },
      mode: testMode,
      workdir: process.cwd(),
    }

    server = await createServerHandle(config)
    const { port } = await server.start(10998)
    serverUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    project = await createTestProject({ template: 'typescript' })
  })

  afterEach(async () => {
    await project.cleanup()
  })

  it('session-header-updates-context-on-save: REST API returns contextState for immediate header update', async () => {
    const restProject = await createProject(serverUrl, { name: 'test', workdir: project.path })
    const restSession = await createSession(serverUrl, { projectId: restProject.id, title: 'Test session' })

    // Set session provider to match the one we'll edit
    await fetch(`${serverUrl}/api/sessions/${restSession.id}/provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: testProviderId, model: testModelId }),
    })

    const modelId = testModelId
    const newContextWindow = 500000

    // Update model context via API
    const response = await fetch(`${serverUrl}/api/providers/${testProviderId}/models/${encodeURIComponent(modelId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contextWindow: newContextWindow }),
    })

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}))
      console.log('API error:', response.status, errorBody)
    }
    expect(response.ok).toBe(true)
    const responseBody = (await response.json()) as {
      success: boolean
      contextState?: {
        currentTokens: number
        maxTokens: number
        compactionCount: number
        dangerZone: boolean
        canCompact: boolean
      } | null
    }

    // Verify API returns contextState for frontend to update session header immediately
    expect(responseBody.success).toBe(true)
    expect(responseBody.contextState).toBeDefined()
    expect(responseBody.contextState?.maxTokens).toBe(newContextWindow)
  })
})
