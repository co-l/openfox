import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { GlobalConfig } from './config.js'

const TEST_DIR = join(tmpdir(), `openfox-init-test-${Date.now()}`)

// Mock the paths module
vi.mock('./paths.js', () => ({
  getGlobalConfigPath: (mode: string) => join(TEST_DIR, mode, 'config.json'),
  getAuthConfigPath: (mode: string) => join(TEST_DIR, mode, 'auth.json'),
}))

// Mock @clack/prompts for interactive prompts
vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  text: vi.fn(),
  password: vi.fn().mockResolvedValue(''),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
  outro: vi.fn(),
  confirm: vi.fn(),
}))

// Mock auth module
vi.mock('./auth.js', () => ({
  saveAuthConfig: vi.fn().mockResolvedValue(undefined),
  hashPassword: vi.fn((pwd: string) => `hashed-${pwd}`),
  loadAuthConfig: vi.fn().mockResolvedValue(null),
}))

describe('init', () => {
  let loadGlobalConfig: typeof import('./config.js').loadGlobalConfig
  let saveGlobalConfig: typeof import('./config.js').saveGlobalConfig
  let runInitWithSelect: typeof import('./init.js').runInitWithSelect

  beforeEach(async () => {
    vi.resetModules()
    const configModule = await import('./config.js')
    loadGlobalConfig = configModule.loadGlobalConfig
    saveGlobalConfig = configModule.saveGlobalConfig
    
    const initModule = await import('./init.js')
    runInitWithSelect = initModule.runInitWithSelect

    await mkdir(join(TEST_DIR, 'production'), { recursive: true })
    await mkdir(join(TEST_DIR, 'development'), { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  describe('runInitWithSelect with existing config', () => {
    it('preserves existing providers when user chooses to keep them', async () => {
      const { select, confirm } = await import('@clack/prompts')
      
      // Mock user choices: keep providers (true), choose localhost (Symbol for 'localhost')
      vi.mocked(confirm).mockResolvedValue(true)
      vi.mocked(select).mockResolvedValue('localhost')

      const existingConfig: GlobalConfig = {
        providers: [
          {
            id: 'provider-1',
            name: 'Existing Provider',
            url: 'http://existing:8000',
            model: 'existing-model',
            backend: 'vllm',
            models: [],
            isActive: true,
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        activeProviderId: 'provider-1',
        defaultModelSelection: undefined,
        activeWorkflowId: undefined,
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
        visionFallback: { enabled: false, url: 'http://localhost:11434', model: 'qwen3-vl:2b', timeout: 120 },
      }

      await saveGlobalConfig('production', existingConfig)
      
      // Run init with existing config
      await runInitWithSelect('production', existingConfig)
      
      const loaded = await loadGlobalConfig('production')
      
      // Verify providers are preserved
      expect(loaded.providers).toHaveLength(1)
      expect(loaded.providers[0]?.id).toBe('provider-1')
      expect(loaded.providers[0]?.name).toBe('Existing Provider')
      expect(loaded.activeProviderId).toBe('provider-1')
    })

    it('updates server.host when preserving providers', async () => {
      const { select, confirm } = await import('@clack/prompts')
      
      // Mock user choices: keep providers (true), choose network access
      vi.mocked(confirm).mockResolvedValue(true)
      vi.mocked(select).mockResolvedValue('network')

      const existingConfig: GlobalConfig = {
        providers: [
          {
            id: 'provider-1',
            name: 'Existing Provider',
            url: 'http://existing:8000',
            model: 'existing-model',
            backend: 'vllm',
            models: [],
            isActive: true,
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        activeProviderId: 'provider-1',
        defaultModelSelection: undefined,
        activeWorkflowId: undefined,
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
        visionFallback: { enabled: false, url: 'http://localhost:11434', model: 'qwen3-vl:2b', timeout: 120 },
      }

      await saveGlobalConfig('production', existingConfig)
      await runInitWithSelect('production', existingConfig)
      
      const loaded = await loadGlobalConfig('production')
      
      // Verify server.host was updated to 0.0.0.0
      expect(loaded.server.host).toBe('0.0.0.0')
      // Verify providers are still preserved
      expect(loaded.providers).toHaveLength(1)
      expect(loaded.providers[0]?.id).toBe('provider-1')
    })

    it('defaults to 127.0.0.1 when network prompt is skipped', async () => {
      const { select, confirm } = await import('@clack/prompts')
      
      // Mock user choices: keep providers (true), skip network prompt (Symbol cancel)
      vi.mocked(confirm).mockResolvedValue(true)
      vi.mocked(select).mockResolvedValue(Symbol.for('clack:cancel'))

      const existingConfig: GlobalConfig = {
        providers: [
          {
            id: 'provider-1',
            name: 'Existing Provider',
            url: 'http://existing:8000',
            model: 'existing-model',
            backend: 'vllm',
            models: [],
            isActive: true,
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        activeProviderId: 'provider-1',
        defaultModelSelection: undefined,
        activeWorkflowId: undefined,
        server: { port: 10369, host: '0.0.0.0', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
        visionFallback: { enabled: false, url: 'http://localhost:11434', model: 'qwen3-vl:2b', timeout: 120 },
      }

      await saveGlobalConfig('production', existingConfig)
      await runInitWithSelect('production', existingConfig)
      
      const loaded = await loadGlobalConfig('production')
      
      // Verify server.host defaulted to 127.0.0.1 (secure)
      expect(loaded.server.host).toBe('127.0.0.1')
    })

    it('preserves all provider data when keeping providers', async () => {
      const { select, confirm } = await import('@clack/prompts')
      
      vi.mocked(confirm).mockResolvedValue(true)
      vi.mocked(select).mockResolvedValue('localhost')

      const existingConfig: GlobalConfig = {
        providers: [
          {
            id: 'provider-1',
            name: 'Test Provider',
            url: 'http://test:8000',
            model: 'test-model',
            backend: 'vllm',
            maxContext: 100000,
            models: [],
            isActive: true,
            createdAt: '2024-01-01T00:00:00Z',
          },
          {
            id: 'provider-2',
            name: 'Second Provider',
            url: 'http://second:8000',
            model: 'second-model',
            backend: 'ollama',
            maxContext: 50000,
            models: [],
            isActive: false,
            createdAt: '2024-01-02T00:00:00Z',
          },
        ],
        activeProviderId: 'provider-1',
        defaultModelSelection: undefined,
        activeWorkflowId: undefined,
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'warn' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
        visionFallback: { enabled: false, url: 'http://localhost:11434', model: 'qwen3-vl:2b', timeout: 120 },
      }

      await saveGlobalConfig('production', existingConfig)
      await runInitWithSelect('production', existingConfig)
      
      const loaded = await loadGlobalConfig('production')
      
      // Verify all provider data is preserved
      expect(loaded.providers).toHaveLength(2)
      expect(loaded.providers[0]).toMatchObject({
        id: 'provider-1',
        name: 'Test Provider',
        url: 'http://test:8000',
        backend: 'vllm',
      })
      expect(loaded.providers[0]?.models).toEqual([
        { id: 'test-model', contextWindow: 100000, source: 'user' },
      ])
      expect(loaded.providers[1]).toMatchObject({
        id: 'provider-2',
        name: 'Second Provider',
        url: 'http://second:8000',
        backend: 'ollama',
      })
      expect(loaded.providers[1]?.models).toEqual([
        { id: 'second-model', contextWindow: 50000, source: 'user' },
      ])
      expect(loaded.activeProviderId).toBe('provider-1')
      expect(loaded.server.port).toBe(10369)
      expect(loaded.logging.level).toBe('warn')
    })

    it('starts fresh when user chooses not to keep providers', async () => {
      const { select, confirm, text } = await import('@clack/prompts')
      
      // User chooses NOT to keep providers
      vi.mocked(confirm).mockResolvedValue(false)
      
      // Then user goes through LLM setup:
      // 1. Select 'other' for LLM server
      // 2. Enter custom URL
      // 3. Choose 'continue' when connection fails
      // 4. Finally choose network accessibility
      
      vi.mocked(select).mockImplementation(async ({ message }: any) => {
        if (message?.includes('Select your LLM')) {
          return 'other'  // Choose 'other' to enter custom URL
        }
        if (message?.includes('Continue with this URL')) {
          return 'continue'  // Continue with the URL anyway
        }
        return 'localhost'  // Network accessibility choice
      })
      
      vi.mocked(text).mockResolvedValue('http://test:8000')

      const existingConfig: GlobalConfig = {
        providers: [
          {
            id: 'old-provider',
            name: 'Old Provider',
            url: 'http://old:8000',
            model: 'old-model',
            backend: 'vllm',
            models: [],
            isActive: true,
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        activeProviderId: 'old-provider',
        defaultModelSelection: undefined,
        activeWorkflowId: undefined,
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
        visionFallback: { enabled: false, url: 'http://localhost:11434', model: 'qwen3-vl:2b', timeout: 120 },
      }

      await saveGlobalConfig('production', existingConfig)
      await runInitWithSelect('production', existingConfig)
      
      const loaded = await loadGlobalConfig('production')
      
      // When user chooses not to keep providers, a new provider is created during LLM setup
      expect(loaded.providers).toHaveLength(1)
      // The old provider should be gone (replaced by new one)
      expect(loaded.providers[0]?.id).not.toBe('old-provider')
      expect(loaded.providers[0]?.name).toBe('Default')
    })
  })

  describe('init with no existing config', () => {
    it('creates config with secure default when no config exists', async () => {
      const { select, text } = await import('@clack/prompts')
      
      // No existing config, so confirm won't be called
      // Mock LLM selection: choose 'other', then provide URL, then 'continue'
      vi.mocked(select).mockImplementation(async ({ message }: any) => {
        if (message?.includes('Select your LLM')) {
          return 'other'
        }
        if (message?.includes('Continue with this URL')) {
          return 'continue'
        }
        return 'localhost'  // Network accessibility choice
      })
      
      vi.mocked(text).mockResolvedValue('http://test:8000')

      await runInitWithSelect('production')
      
      const loaded = await loadGlobalConfig('production')
      
      // A new provider is created during LLM setup
      expect(loaded.providers).toHaveLength(1)
      expect(loaded.server.host).toBe('127.0.0.1')
    })
  })
})
