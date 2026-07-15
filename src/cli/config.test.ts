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
  let loadGlobalConfig: typeof import('./config.js').loadGlobalConfig
  let saveGlobalConfig: typeof import('./config.js').saveGlobalConfig
  let getActiveProvider: typeof import('./config.js').getActiveProvider
  let getDefaultModel: typeof import('./config.js').getDefaultModel

  beforeEach(async () => {
    vi.resetModules()
    const configModule = await import('./config.js')
    loadGlobalConfig = configModule.loadGlobalConfig
    saveGlobalConfig = configModule.saveGlobalConfig
    getActiveProvider = configModule.getActiveProvider
    getDefaultModel = configModule.getDefaultModel

    await mkdir(join(TEST_DIR, 'production'), { recursive: true })
    await mkdir(join(TEST_DIR, 'development'), { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  describe('loadGlobalConfig', () => {
    it('returns empty providers for fresh install', async () => {
      const loaded = await loadGlobalConfig('production')

      expect(loaded.providers).toEqual([])
      expect(loaded.activeProviderId).toBeUndefined()
    })

    it('loads config with providers array', async () => {
      const config = {
        providers: [
          {
            id: 'test-123',
            name: 'Test Provider',
            url: 'http://localhost:8000/v1',
            backend: 'vllm' as const,
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        defaultModelSelection: 'test-123/test-model',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
        visionFallback: {
          enabled: false,
          url: 'http://localhost:11434',
          model: 'qwen3.5:0.8b',
          timeout: 120,
          backend: 'ollama' as const,
        },
      }

      await writeFile(join(TEST_DIR, 'production', 'config.json'), JSON.stringify(config))
      const loaded = await loadGlobalConfig('production')

      expect(loaded.providers).toHaveLength(1)
      expect(loaded.providers[0]?.name).toBe('Test Provider')
      expect(loaded.defaultModelSelection).toBe('test-123/test-model')
    })

    it('preserves llm timeout config', async () => {
      const config = {
        providers: [],
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'error' as const },
        database: { path: '' },
        workspace: { workdir: process.cwd() },
        llm: { timeout: 600000, idleTimeout: 600000 },
      }

      await writeFile(join(TEST_DIR, 'production', 'config.json'), JSON.stringify(config))
      const loaded = await loadGlobalConfig('production')

      expect(loaded.llm).toEqual({ timeout: 600000, idleTimeout: 600000 })
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
        visionFallback: {
          enabled: false,
          url: 'http://localhost:11434',
          model: 'qwen3.5:0.8b',
          timeout: 120,
          backend: 'ollama' as const,
        },
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
        visionFallback: {
          enabled: false,
          url: 'http://localhost:11434',
          model: 'qwen3.5:0.8b',
          timeout: 120,
          backend: 'ollama' as const,
        },
      }

      await saveGlobalConfig('production', configWithUserModels)
      const loaded = await loadGlobalConfig('production')

      expect(loaded.providers).toHaveLength(1)
      expect(loaded.providers[0]?.models).toEqual([
        { id: 'model-x', contextWindow: 128000, source: 'user' },
        { id: 'model-y', contextWindow: 256000, source: 'user' },
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
        visionFallback: {
          enabled: false,
          url: 'http://localhost:11434',
          model: 'qwen3.5:0.8b',
          timeout: 120,
          backend: 'ollama' as const,
        },
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
        visionFallback: {
          enabled: false,
          url: 'http://localhost:11434',
          model: 'qwen3.5:0.8b',
          timeout: 120,
          backend: 'ollama' as const,
        },
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
        visionFallback: {
          enabled: false,
          url: 'http://localhost:11434',
          model: 'qwen3.5:0.8b',
          timeout: 120,
          backend: 'ollama' as const,
        },
      }

      await saveGlobalConfig('production', originalConfig)

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
            models: [{ id: 'Intel/Qwen3.5-397B', contextWindow: 200000, source: 'user' as const }],
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

      await writeFile(join(TEST_DIR, 'production', 'config.json'), JSON.stringify(configWithSlashInModel))
      const loaded = await loadGlobalConfig('production')

      expect(loaded.defaultModelSelection).toBe('test-provider/Intel/Qwen3.5-397B')

      const activeProvider = getActiveProvider(loaded)
      expect(activeProvider?.id).toBe('test-provider')

      const defaultModel = getDefaultModel(loaded)
      expect(defaultModel).toBe('Intel/Qwen3.5-397B')
    })
  })

  describe('mcpServers config', () => {
    it('should parse valid mcpServers config', async () => {
      const raw = {
        providers: [],
        mcpServers: {
          brave: {
            transport: 'stdio',
            command: 'npx',
            args: ['@brave/brave-search-mcp-server'],
            env: { BRAVE_API_KEY: 'test-key' },
          },
          filesystem: {
            transport: 'stdio',
            command: 'node',
            args: ['server.js', '/tmp'],
          },
        },
      }

      await writeFile(join(TEST_DIR, 'production', 'config.json'), JSON.stringify(raw))
      const loaded = await loadGlobalConfig('production')

      expect(loaded.mcpServers).toBeDefined()
      expect(Object.keys(loaded.mcpServers!)).toEqual(['brave', 'filesystem'])
      expect(loaded.mcpServers!['brave']!.command).toBe('npx')
      expect(loaded.mcpServers!['brave']!.transport).toBe('stdio')
      expect(loaded.mcpServers!['brave']!.env).toEqual({ BRAVE_API_KEY: 'test-key' })
      expect(loaded.mcpServers!['filesystem']!.args).toEqual(['server.js', '/tmp'])
    })

    it('should parse mcpServers with disabledTools', async () => {
      const raw = {
        providers: [],
        mcpServers: {
          test: {
            transport: 'stdio',
            command: 'node',
            disabledTools: ['tool_a', 'tool_b'],
          },
        },
      }

      await writeFile(join(TEST_DIR, 'production', 'config.json'), JSON.stringify(raw))
      const loaded = await loadGlobalConfig('production')

      expect(loaded.mcpServers!['test']!.disabledTools).toEqual(['tool_a', 'tool_b'])
    })

    it('should handle missing mcpServers', async () => {
      const loaded = await loadGlobalConfig('production')
      expect(loaded.mcpServers).toBeUndefined()
    })

    it('should preserve mcpServers through save and load cycle', async () => {
      const raw = {
        providers: [],
        mcpServers: {
          brave: {
            transport: 'stdio' as const,
            command: 'npx',
            args: ['@brave/brave-search-mcp-server'],
          },
        },
      }

      await saveGlobalConfig('test', raw)
      const loaded = await loadGlobalConfig('test')
      expect(loaded.mcpServers).toBeDefined()
      expect(loaded.mcpServers!['brave']!.command).toBe('npx')
    })
  })

  it('preserves provider auth fields when loading config', async () => {
    const configPath = join(TEST_DIR, 'production', 'config.json')
    await mkdir(join(TEST_DIR, 'production'), { recursive: true })
    await writeFile(
      configPath,
      JSON.stringify({
        providers: [
          {
            id: 'external',
            name: 'External Account Provider',
            url: 'https://provider.example/v1',
            backend: 'openai',
            models: [],
            isActive: true,
            createdAt: new Date().toISOString(),
            authAdapter: 'example-auth',
            transportAdapter: 'example-transport',
            credentialRef: 'credential-ref-1',
          },
        ],
        defaultModelSelection: 'external/gpt-5.4',
      }),
    )

    const loaded = await loadGlobalConfig('production')
    expect(loaded.providers[0]).toEqual(
      expect.objectContaining({
        authAdapter: 'example-auth',
        transportAdapter: 'example-transport',
        credentialRef: 'credential-ref-1',
      }),
    )
  })

  it('accepts a concise preset-backed provider entry', async () => {
    await writeFile(
      join(TEST_DIR, 'production', 'config.json'),
      JSON.stringify({ providers: [{ id: 'main', preset: 'example' }] }),
    )

    const loaded = await loadGlobalConfig('production')
    expect(loaded.providers).toEqual([
      expect.objectContaining({
        id: 'main',
        preset: 'example',
        name: 'main',
        url: '',
        backend: 'unknown',
        models: [],
        isActive: false,
      }),
    ])
  })
})
