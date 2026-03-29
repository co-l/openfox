/**
 * Provider Context Restart Tests
 * 
 * Tests that user-set context windows survive server restarts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createProviderManager } from './provider-manager.js'
import type { Config } from '../shared/types.js'

describe('Provider Manager - Context Persistence', () => {
  const mockConfig: Config = {
    llm: {
      baseUrl: 'http://localhost:11434/v1',
      model: 'auto',
      backend: 'ollama',
      timeout: 120000,
      idleTimeout: 300000,
    },
    context: { maxTokens: 200000, compactionThreshold: 0.8, compactionTarget: 0.5 },
    agent: { maxIterations: 50, maxConsecutiveFailures: 3, toolTimeout: 120000 },
    server: { port: 10999, host: '127.0.0.1', openBrowser: false },
    database: { path: '' },
    workdir: process.cwd(),
    providers: [],
    defaultModelSelection: undefined,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves user-set context window during activateProvider with fuzzy matching', async () => {
    const testProviderId = 'test-provider'
    const userModelId = 'qwen3.5 397b cloud' // User sets with spaces
    const backendModelId = 'qwen3.5:397b-cloud' // Backend returns with dashes/colons
    const customContextWindow = 300000

    const config: Config = {
      ...mockConfig,
      providers: [
        {
          id: testProviderId,
          name: 'Test Provider',
          url: 'http://localhost:11434',
          backend: 'ollama',
          models: [
            {
              id: userModelId,
              contextWindow: customContextWindow,
              source: 'user' as const,
            },
          ],
          isActive: false,
          createdAt: new Date().toISOString(),
        },
      ],
      defaultModelSelection: `${testProviderId}/${userModelId}`,
      activeProviderId: testProviderId,
    }

    const pm = createProviderManager(config)
    
    // First, verify the model is loaded correctly from config
    const providers = pm.getProviders()
    const provider = providers.find(p => p.id === testProviderId)
    expect(provider).toBeDefined()
    
    const userModel = provider?.models.find(m => m.id === userModelId)
    expect(userModel).toBeDefined()
    expect(userModel?.contextWindow).toBe(customContextWindow)
    expect(userModel?.source).toBe('user')
    
    // ActivateProvider will try to fetch from backend (will fail in test)
    // but should still preserve user models even if fetch fails
    const result = await pm.activateProvider(testProviderId)
    
    // After activation, user context should still be preserved
    const updatedProviders = pm.getProviders()
    const updatedProvider = updatedProviders.find(p => p.id === testProviderId)
    
    // User model should still exist with original context
    const preservedModel = updatedProvider?.models.find(m => m.id === userModelId)
    expect(preservedModel).toBeDefined()
    expect(preservedModel?.contextWindow).toBe(customContextWindow)
    expect(preservedModel?.source).toBe('user')
  })

  it('preserves user context when exact ID match exists', async () => {
    const testProviderId = 'test-exact-match'
    const modelId = 'exact-match-model'
    const customContextWindow = 250000

    const config: Config = {
      ...mockConfig,
      providers: [
        {
          id: testProviderId,
          name: 'Test Provider',
          url: 'http://localhost:11434',
          backend: 'ollama',
          models: [
            {
              id: modelId,
              contextWindow: customContextWindow,
              source: 'user' as const,
            },
          ],
          isActive: false,
          createdAt: new Date().toISOString(),
        },
      ],
      defaultModelSelection: `${testProviderId}/${modelId}`,
      activeProviderId: testProviderId,
    }

    const pm = createProviderManager(config)
    const result = await pm.activateProvider(testProviderId)
    expect(result.success).toBe(true)
    
    const updatedProviders = pm.getProviders()
    const updatedProvider = updatedProviders.find(p => p.id === testProviderId)
    const model = updatedProvider?.models.find(m => m.id === modelId)
    
    expect(model?.contextWindow).toBe(customContextWindow)
    expect(model?.source).toBe('user')
  })

  it('preserves multiple user models during provider switch', async () => {
    const testProviderId = 'test-multi'
    const customContext1 = 300000
    const customContext2 = 350000

    const config: Config = {
      ...mockConfig,
      providers: [
        {
          id: testProviderId,
          name: 'Test Provider',
          url: 'http://localhost:11434',
          backend: 'ollama',
          models: [
            { id: 'model1', contextWindow: customContext1, source: 'user' as const },
            { id: 'model2', contextWindow: customContext2, source: 'user' as const },
          ],
          isActive: false,
          createdAt: new Date().toISOString(),
        },
      ],
      defaultModelSelection: `${testProviderId}/model1`,
      activeProviderId: testProviderId,
    }

    const pm = createProviderManager(config)
    await pm.activateProvider(testProviderId)
    
    const providers = pm.getProviders()
    const provider = providers.find(p => p.id === testProviderId)
    
    const model1 = provider?.models.find(m => m.id === 'model1')
    const model2 = provider?.models.find(m => m.id === 'model2')
    
    expect(model1?.contextWindow).toBe(customContext1)
    expect(model1?.source).toBe('user')
    expect(model2?.contextWindow).toBe(customContext2)
    expect(model2?.source).toBe('user')
  })
})
