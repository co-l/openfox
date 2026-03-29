import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServerHandle } from '../src/server/index.js'
import { loadGlobalConfig, saveGlobalConfig, type GlobalConfig } from '../src/cli/config.js'
import type { Config } from '../src/shared/types.js'

describe('Provider Context Restart', () => {
  const testMode = 'production'
  let config: Config
  let serverHandle: Awaited<ReturnType<typeof createServerHandle>>

  beforeAll(async () => {
    // Load and prepare config
    const globalConfig = await loadGlobalConfig(testMode)
    
    // Ensure we have a test provider with a user-set context window
    const testProviderId = 'test-restart-provider'
    const testModelId = 'test-model-restart'
    const customContextWindow = 262144
    
    const updatedConfig: GlobalConfig = {
      ...globalConfig,
      providers: [
        {
          id: testProviderId,
          name: 'Test Restart Provider',
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
        ...(globalConfig.providers?.filter(p => p.id !== testProviderId) ?? []),
      ],
      defaultModelSelection: `${testProviderId}/${testModelId}`,
      activeProviderId: testProviderId,
    }
    
    await saveGlobalConfig(testMode, updatedConfig)
    
    // Create server config
    config = {
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
      context: { maxTokens: 200000, compactionThreshold: 0.8, compactionTarget: 0.5 },
      agent: { maxIterations: 50, maxConsecutiveFailures: 3, toolTimeout: 120000 },
      server: { port: 10999, host: '127.0.0.1', openBrowser: false },
      database: { path: '' },
      logging: { level: 'error' },
      mode: testMode,
      workdir: process.cwd(),
    }
  })

  afterAll(async () => {
    await serverHandle?.close()
  })

  it('preserves user-set context window after server restart', async () => {
    // Start server (simulates restart)
    serverHandle = await createServerHandle(config)
    await serverHandle.start(10999)
    
    // Give it time to initialize
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Get the provider manager and check the context window
    const providerManager = serverHandle.ctx.providerManager!
    const providers = providerManager.getProviders()
    
    const testProvider = providers.find(p => p.id === config.activeProviderId)
    expect(testProvider).toBeDefined()
    
    const testModel = testProvider?.models.find(m => m.id === config.llm.model || m.id.includes('test-model-restart'))
    expect(testModel).toBeDefined()
    
    // The key assertion: user-set context window should be preserved
    expect(testModel?.contextWindow).toBe(262144)
    expect(testModel?.source).toBe('user')
    
    await serverHandle.close()
  })

  it('preserves user context when switching providers with fuzzy model ID match', async () => {
    const globalConfig = await loadGlobalConfig(testMode)
    
    // Set up a provider with a model that has a different ID format (spaces vs dashes)
    const testProviderId = 'test-fuzzy-provider'
    const userModelId = 'qwen3.5 397b cloud' // User sets with spaces
    const backendModelId = 'qwen3.5:397b-cloud' // Backend returns with dashes/colons
    const customContextWindow = 300000
    
    const configWithFuzzy: GlobalConfig = {
      ...globalConfig,
      providers: [
        {
          id: testProviderId,
          name: 'Test Fuzzy Provider',
          url: 'http://localhost:11434',
          backend: 'ollama',
          models: [
            {
              id: userModelId,
              contextWindow: customContextWindow,
              source: 'user' as const,
            },
          ],
          isActive: true,
          createdAt: new Date().toISOString(),
        },
        ...(globalConfig.providers?.filter(p => p.id !== testProviderId) ?? []),
      ],
      defaultModelSelection: `${testProviderId}/${userModelId}`,
      activeProviderId: testProviderId,
    }
    
    await saveGlobalConfig(testMode, configWithFuzzy)
    
    const fuzzyConfig: Config = {
      providers: configWithFuzzy.providers,
      defaultModelSelection: configWithFuzzy.defaultModelSelection,
      activeProviderId: configWithFuzzy.activeProviderId,
      llm: {
        baseUrl: 'http://localhost:11434/v1',
        model: userModelId,
        backend: 'ollama',
        timeout: 120000,
        idleTimeout: 300000,
        disableThinking: false,
      },
      context: { maxTokens: 200000, compactionThreshold: 0.8, compactionTarget: 0.5 },
      agent: { maxIterations: 50, maxConsecutiveFailures: 3, toolTimeout: 120000 },
      server: { port: 10998, host: '127.0.0.1', openBrowser: false },
      database: { path: '' },
      logging: { level: 'error' },
      mode: testMode,
      workdir: process.cwd(),
    }
    
    const fuzzyServer = await createServerHandle(fuzzyConfig)
    await fuzzyServer.start(10998)
    
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    const pm = fuzzyServer.ctx.providerManager!
    const providers = pm.getProviders()
    const fuzzyProvider = providers.find(p => p.id === testProviderId)
    
    expect(fuzzyProvider).toBeDefined()
    
    // After refresh/activation, the model ID should be updated to match backend format
    // but the context window should be preserved
    const matchedModel = fuzzyProvider?.models.find(m => 
      m.id === backendModelId || m.id === userModelId || m.id.includes('qwen3.5')
    )
    
    expect(matchedModel).toBeDefined()
    expect(matchedModel?.contextWindow).toBe(customContextWindow)
    expect(matchedModel?.source).toBe('user')
    
    await fuzzyServer.close()
  })
})
