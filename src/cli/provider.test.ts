import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), `openfox-provider-test-${Date.now()}`)

// Mock paths module
vi.mock('./paths.js', () => ({
  getGlobalConfigPath: (mode: string) => join(TEST_DIR, mode, 'config.json'),
}))

describe('provider commands', () => {
  let loadGlobalConfig: typeof import('./config.js').loadGlobalConfig
  let saveGlobalConfig: typeof import('./config.js').saveGlobalConfig
  let addProvider: typeof import('./config.js').addProvider
  let removeProvider: typeof import('./config.js').removeProvider
  let activateProvider: typeof import('./config.js').activateProvider
  let getActiveProvider: typeof import('./config.js').getActiveProvider

  beforeEach(async () => {
    vi.resetModules()
    const configModule = await import('./config.js')
    loadGlobalConfig = configModule.loadGlobalConfig
    saveGlobalConfig = configModule.saveGlobalConfig
    addProvider = configModule.addProvider
    removeProvider = configModule.removeProvider
    activateProvider = configModule.activateProvider
    getActiveProvider = configModule.getActiveProvider

    await mkdir(join(TEST_DIR, 'production'), { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  describe('addProvider', () => {
    it('adds first provider and makes it active', () => {
      const config = {
        providers: [],
        activeProviderId: undefined as string | undefined,
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const updated = addProvider(config, {
        name: 'Test Provider',
        url: 'http://localhost:8000/v1',

        backend: 'vllm',
        models: [],
        isActive: false, // Should become active anyway (first provider)
      })

      expect(updated.providers).toHaveLength(1)
      expect(updated.providers[0]?.name).toBe('Test Provider')
      expect(updated.providers[0]?.isActive).toBe(true)
      expect(updated.activeProviderId).toBe(updated.providers[0]?.id)
    })

    it('adds second provider without changing active', () => {
      const config = {
        providers: [
          {
            id: 'first-id',
            name: 'First',
            url: 'http://localhost:8000/v1',

            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        activeProviderId: 'first-id',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const updated = addProvider(config, {
        name: 'Second',
        url: 'http://localhost:11434',

        backend: 'ollama',
        models: [],
        isActive: false,
      })

      expect(updated.providers).toHaveLength(2)
      expect(updated.providers[0]?.isActive).toBe(true)
      expect(updated.providers[1]?.isActive).toBe(false)
      expect(updated.activeProviderId).toBe('first-id')
    })

    it('adds provider with isActive=true and updates existing providers', () => {
      const config = {
        providers: [
          {
            id: 'first-id',
            name: 'First',
            url: 'http://localhost:8000/v1',

            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        activeProviderId: 'first-id',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const updated = addProvider(config, {
        name: 'Second',
        url: 'http://localhost:11434',

        backend: 'ollama',
        models: [],
        isActive: true, // Make this one active
      })

      expect(updated.providers).toHaveLength(2)
      expect(updated.providers[0]?.isActive).toBe(false) // First deactivated
      expect(updated.providers[1]?.isActive).toBe(true) // Second is active
      expect(updated.activeProviderId).toBe(updated.providers[1]?.id)
    })
  })

  describe('removeProvider', () => {
    it('removes provider and activates next if active was removed', () => {
      const config = {
        providers: [
          {
            id: 'first-id',
            name: 'First',
            url: 'http://localhost:8000/v1',

            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'second-id',
            name: 'Second',
            url: 'http://localhost:11434',

            backend: 'ollama' as const,
            models: [],
            isActive: false,
            createdAt: new Date().toISOString(),
          },
        ],
        activeProviderId: 'first-id',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const updated = removeProvider(config, 'first-id')

      expect(updated.providers).toHaveLength(1)
      expect(updated.providers[0]?.id).toBe('second-id')
      expect(updated.providers[0]?.isActive).toBe(true)
      expect(updated.activeProviderId).toBe('second-id')
    })

    it('removes non-active provider without changing active', () => {
      const config = {
        providers: [
          {
            id: 'first-id',
            name: 'First',
            url: 'http://localhost:8000/v1',

            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'second-id',
            name: 'Second',
            url: 'http://localhost:11434',

            backend: 'ollama' as const,
            models: [],
            isActive: false,
            createdAt: new Date().toISOString(),
          },
        ],
        activeProviderId: 'first-id',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const updated = removeProvider(config, 'second-id')

      expect(updated.providers).toHaveLength(1)
      expect(updated.providers[0]?.id).toBe('first-id')
      expect(updated.activeProviderId).toBe('first-id')
    })

    it('clears activeProviderId when last provider is removed', () => {
      const config = {
        providers: [
          {
            id: 'only-id',
            name: 'Only',
            url: 'http://localhost:8000/v1',

            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        activeProviderId: 'only-id',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const updated = removeProvider(config, 'only-id')

      expect(updated.providers).toHaveLength(0)
      expect(updated.activeProviderId).toBeUndefined()
    })
  })

  describe('activateProvider', () => {
    it('activates provider and deactivates others', () => {
      const config = {
        providers: [
          {
            id: 'first-id',
            name: 'First',
            url: 'http://localhost:8000/v1',

            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'second-id',
            name: 'Second',
            url: 'http://localhost:11434',

            backend: 'ollama' as const,
            models: [],
            isActive: false,
            createdAt: new Date().toISOString(),
          },
        ],
        activeProviderId: 'first-id',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const updated = activateProvider(config, 'second-id')

      expect(updated.providers[0]?.isActive).toBe(false)
      expect(updated.providers[1]?.isActive).toBe(true)
      expect(updated.activeProviderId).toBe('second-id')
    })

    it('returns unchanged config for non-existent provider', () => {
      const config = {
        providers: [
          {
            id: 'first-id',
            name: 'First',
            url: 'http://localhost:8000/v1',

            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        activeProviderId: 'first-id',
        defaultModelSelection: undefined,
        activeWorkflowId: undefined,
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
        visionFallback: { enabled: false, url: 'http://localhost:11434', model: 'qwen3-vl:2b', timeout: 120 },
      }

      const updated = activateProvider(config, 'non-existent')

      expect(updated).toEqual(config)
    })
  })

  describe('getActiveProvider', () => {
    it('returns active provider', () => {
      const config = {
        providers: [
          {
            id: 'first-id',
            name: 'First',
            url: 'http://localhost:8000/v1',

            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        activeProviderId: 'first-id',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const active = getActiveProvider(config)

      expect(active?.id).toBe('first-id')
      expect(active?.name).toBe('First')
    })

    it('returns undefined when no active provider', () => {
      const config = {
        providers: [],
        activeProviderId: undefined as string | undefined,
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      const active = getActiveProvider(config)

      expect(active).toBeUndefined()
    })
  })

  describe('provider persistence', () => {
    it('saves and loads providers correctly', async () => {
      const config = {
        providers: [
          {
            id: 'test-id',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',

            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        activeProviderId: 'test-id',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
      }

      await saveGlobalConfig('production', config)
      const loaded = await loadGlobalConfig('production')

      expect(loaded.providers).toHaveLength(1)
      expect(loaded.providers[0]?.name).toBe('Test Provider')
      expect(loaded.activeProviderId).toBe('test-id')
    })
  })
})
