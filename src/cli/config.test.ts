import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Provider } from '../shared/types.js'

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

  beforeEach(async () => {
    // Clear module cache and re-import
    vi.resetModules()
    const configModule = await import('./config.js')
    loadGlobalConfig = configModule.loadGlobalConfig
    saveGlobalConfig = configModule.saveGlobalConfig
    migrateConfig = configModule.migrateConfig

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

      const migrated = migrateConfig(oldConfig)

      expect(migrated.providers).toHaveLength(1)
      expect(migrated.providers[0]).toMatchObject({
        name: 'Default',
        url: 'http://localhost:8000/v1',
        model: 'qwen3-32b',
        backend: 'vllm',
        maxContext: 200000,
        isActive: true,
      })
      expect(migrated.activeProviderId).toBe(migrated.providers[0]?.id)
      // Old llm key should be removed
      expect('llm' in migrated).toBe(false)
    })

    it('preserves new providers format unchanged', () => {
      const newConfig = {
        providers: [
          {
            id: 'test-id',
            name: 'My Provider',
            url: 'http://localhost:8000/v1',
            model: 'qwen3-32b',
            backend: 'vllm' as const,
            isActive: true,
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        activeProviderId: 'test-id',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const migrated = migrateConfig(newConfig)

      expect(migrated).toEqual(newConfig)
    })

    it('handles empty config with defaults', () => {
      const migrated = migrateConfig({})

      expect(migrated.providers).toEqual([])
      expect(migrated.activeProviderId).toBeUndefined()
      expect(migrated.server).toBeDefined()
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

      const migrated = migrateConfig(oldConfig)

      expect(migrated.providers[0]?.apiKey).toBe('sk-test-key')
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
      expect(loaded.providers[0]?.model).toBe('test-model')
      expect(loaded.activeProviderId).toBeDefined()
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
  })
})
