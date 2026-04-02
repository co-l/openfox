import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), `openfox-config-test-${Date.now()}`)

// Mock the paths module
vi.mock('./paths.js', () => ({
  getGlobalConfigPath: (mode: string) => join(TEST_DIR, mode, 'config.json'),
}))

describe('config', () => {
  // Import after mocking
  let loadGlobalConfig: typeof import('./config.js').loadGlobalConfig
  let saveGlobalConfig: typeof import('./config.js').saveGlobalConfig
  let migrateConfig: typeof import('./config.js').migrateConfig
  let getActiveProvider: typeof import('./config.js').getActiveProvider
  let getDefaultModel: typeof import('./config.js').getDefaultModel

  beforeEach(async () => {
    // Clear module cache and re-import
    vi.resetModules()
    const configModule = await import('./config.js')
    loadGlobalConfig = configModule.loadGlobalConfig
    saveGlobalConfig = configModule.saveGlobalConfig
    migrateConfig = configModule.migrateConfig
    getActiveProvider = configModule.getActiveProvider
    getDefaultModel = configModule.getDefaultModel

    await mkdir(join(TEST_DIR, 'production'), { recursive: true })
    await mkdir(join(TEST_DIR, 'development'), { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  describe('migrateConfig', () => {
    it('converts old llm format to providers array', () => {
      const oldConfig = {
        llm: {
          url: 'http://localhost:8000/v1',
          model: 'qwen3-32b',
          backend: 'vllm' as const,
          maxContext: 200000,
          disableThinking: false,
        },
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const result = migrateConfig(oldConfig)
      const migrated = result.config

      expect(migrated.providers).toHaveLength(1)
      expect(migrated.providers[0]).toMatchObject({
        name: 'Default',
        url: 'http://localhost:8000/v1',
        backend: 'vllm',
        isActive: true,
      })
      expect(migrated.providers[0]?.models).toEqual([
        { id: 'qwen3-32b', contextWindow: 200000, source: 'user' },
      ])
      expect(migrated.defaultModelSelection).toMatch(/^[a-f0-9-]+\/qwen3-32b$/)
      // Old llm key should be removed
      expect('llm' in migrated).toBe(false)
      expect(result.migrated).toBe(true)
    })

    it('logs warning when migrating legacy maxContext', () => {
      const oldConfig = {
        providers: [
          {
            id: 'test-id',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm' as const,
            maxContext: 128000,
            isActive: true,
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = migrateConfig(oldConfig)
      expect(consoleWarnSpy).toHaveBeenCalledWith('Migrating legacy maxContext to model-specific config')
      expect(result.migrated).toBe(true)
      consoleWarnSpy.mockRestore()
    })

    it('preserves new providers format unchanged', () => {
      const newConfig = {
        providers: [
          {
            id: 'test-id',
            name: 'My Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        defaultModelSelection: 'test-id/qwen3-32b',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const result = migrateConfig(newConfig)

      expect(result.config).toEqual(newConfig)
      expect(result.migrated).toBe(false)
    })

    it('handles empty config with defaults', () => {
      const result = migrateConfig({})

      expect(result.config.providers).toEqual([])
      expect(result.config.activeProviderId).toBeUndefined()
      expect(result.config.server).toBeDefined()
      expect(result.migrated).toBe(false)
    })

    it('preserves apiKey from old config if present', () => {
      const oldConfig = {
        llm: {
          url: 'https://api.openai.com/v1',
          model: 'gpt-4',
          backend: 'vllm' as const,
          apiKey: 'sk-test-key',
          maxContext: 128000,
          disableThinking: false,
        },
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const result = migrateConfig(oldConfig)

      expect(result.config.providers[0]?.apiKey).toBe('sk-test-key')
    })
  })

  describe('loadGlobalConfig', () => {
    it('migrates old config format on load', async () => {
      const oldConfig = {
        llm: {
          url: 'http://localhost:8000/v1',
          model: 'test-model',
          backend: 'vllm',
          maxContext: 200000,
          disableThinking: false,
        },
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      await writeFile(
        join(TEST_DIR, 'production', 'config.json'),
        JSON.stringify(oldConfig)
      )

      const loaded = await loadGlobalConfig('production')

      expect(loaded.providers).toHaveLength(1)
      expect(loaded.defaultModelSelection).toMatch(/^[a-f0-9-]+\/test-model$/)
      expect(loaded.activeProviderId).toBeUndefined()
    })

    it('returns empty providers for fresh install', async () => {
      const loaded = await loadGlobalConfig('production')

      expect(loaded.providers).toEqual([])
      expect(loaded.activeProviderId).toBeUndefined()
    })
  })

  describe('saveGlobalConfig', () => {
    it('saves config with providers array', async () => {
      const config = {
        providers: [
          {
            id: 'test-123',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            model: 'test-model',
            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        activeProviderId: 'test-123',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      await saveGlobalConfig('production', config)
      const loaded = await loadGlobalConfig('production')

      expect(loaded.providers).toHaveLength(1)
      expect(loaded.providers[0]?.name).toBe('Test Provider')
      expect(loaded.activeProviderId).toBe('test-123')
    })
  })

  describe('user-defined model context preservation', () => {
    it('preserves user-set contextWindow values across save/load cycle', async () => {
      const configWithUserModels = {
        providers: [
          {
            id: 'test-provider-123',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm' as const,
            models: [
              { id: 'model-x', contextWindow: 128000, source: 'user' as const },
              { id: 'model-y', contextWindow: 256000, source: 'user' as const },
            ],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        defaultModelSelection: 'test-provider-123/model-x',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      await saveGlobalConfig('production', configWithUserModels)
      const loaded = await loadGlobalConfig('production')

      expect(loaded.providers).toHaveLength(1)
      expect(loaded.providers[0]?.models).toEqual([
        { id: 'model-x', contextWindow: 128000, source: 'user' },
        { id: 'model-y', contextWindow: 256000, source: 'user' },
      ])
    })

    it('preserves existing models array when provider has both legacy maxContext and models', () => {
      const configWithLegacyAndModels = {
        providers: [
          {
            id: 'test-provider-456',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm' as const,
            maxContext: 200000,
            models: [
              { id: 'model-x', contextWindow: 128000, source: 'user' as const },
              { id: 'model-y', contextWindow: 256000, source: 'user' as const },
            ],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        defaultModelSelection: 'test-provider-456/model-x',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const result = migrateConfig(configWithLegacyAndModels)

      expect(result.migrated).toBe(false)
      expect(result.config.providers[0]?.models).toEqual([
        { id: 'model-x', contextWindow: 128000, source: 'user' },
        { id: 'model-y', contextWindow: 256000, source: 'user' },
      ])
    })

    it('migrates legacy maxContext to models array when no models array exists', () => {
      const configWithOnlyLegacyMaxContext = {
        providers: [
          {
            id: 'test-provider-789',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm' as const,
            maxContext: 150000,
            model: 'custom-model',
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const result = migrateConfig(configWithOnlyLegacyMaxContext)

      expect(result.migrated).toBe(true)
      expect(result.config.providers[0]?.models).toEqual([
        { id: 'custom-model', contextWindow: 150000, source: 'user' },
      ])
    })
  })

  describe('server host configuration', () => {
    it('saves and loads server.host = 0.0.0.0 for network access', async () => {
      const config = {
        providers: [],
        activeProviderId: undefined,
        server: { port: 10369, host: '0.0.0.0', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      await saveGlobalConfig('production', config)
      const loaded = await loadGlobalConfig('production')

      expect(loaded.server.host).toBe('0.0.0.0')
    })

    it('saves and loads server.host = 127.0.0.1 for localhost only', async () => {
      const config = {
        providers: [],
        activeProviderId: undefined,
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      await saveGlobalConfig('production', config)
      const loaded = await loadGlobalConfig('production')

      expect(loaded.server.host).toBe('127.0.0.1')
    })

    it('preserves server.host when updating other settings', async () => {
      const originalConfig = {
        providers: [
          {
            id: 'test-123',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            model: 'test-model',
            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        activeProviderId: 'test-123',
        server: { port: 10369, host: '0.0.0.0', openBrowser: true },
        logging: { level: 'warn' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      await saveGlobalConfig('production', originalConfig)
      
      // Simulate updating only logging level
      const updatedConfig = await loadGlobalConfig('production')
      updatedConfig.logging.level = 'error' as const
      
      await saveGlobalConfig('production', updatedConfig)
      const reloaded = await loadGlobalConfig('production')

      expect(reloaded.server.host).toBe('0.0.0.0')
      expect(reloaded.server.port).toBe(10369)
      expect(reloaded.logging.level).toBe('error')
      expect(reloaded.providers).toHaveLength(1)
    })

    it('handles model names with slashes in defaultModelSelection', async () => {
      const configWithSlashInModel = {
        providers: [
          {
            id: 'test-provider',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm' as const,
            models: [
              { id: 'Intel/Qwen3.5-397B', contextWindow: 200000, source: 'user' as const },
            ],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        defaultModelSelection: 'test-provider/Intel/Qwen3.5-397B',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const result = migrateConfig(configWithSlashInModel)
      expect(result.migrated).toBe(false)
      expect(result.config.defaultModelSelection).toBe('test-provider/Intel/Qwen3.5-397B')
      
      const activeProvider = getActiveProvider(result.config)
      expect(activeProvider?.id).toBe('test-provider')
      
      const defaultModel = getDefaultModel(result.config)
      expect(defaultModel).toBe('Intel/Qwen3.5-397B')
    })
  })
})
