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

describe('resolveVisionFallback', () => {
  let resolveVisionFallback: typeof import('./config.js').resolveVisionFallback
  let getVisionFallback: typeof import('./config.js').getVisionFallback

  beforeEach(async () => {
    vi.resetModules()
    const configModule = await import('./config.js')
    resolveVisionFallback = configModule.resolveVisionFallback
    getVisionFallback = configModule.getVisionFallback
  })

  const visionProvider = {
    id: 'vision-provider',
    name: 'Vision Provider',
    url: 'http://vision-server:8000/v1',
    backend: 'openai' as const,
    apiKey: 'sk-test-key-123',
    models: [
      { id: 'gpt-4o-vision', contextWindow: 128000, source: 'backend' as const, supportsVision: true },
      { id: 'gpt-4o-mini', contextWindow: 64000, source: 'backend' as const, supportsVision: true },
      { id: 'text-only-model', contextWindow: 32000, source: 'backend' as const },
    ],
    isActive: true,
    createdAt: new Date().toISOString(),
  }

  function makeConfig(overrides?: Record<string, unknown>): any {
    return {
      providers: [visionProvider],
      server: { port: 10369, host: '127.0.0.1', openBrowser: true },
      logging: { level: 'error' as const },
      database: { path: '' },
      workspace: { workdir: process.cwd() },
      visionFallback: {
        enabled: false,
        url: 'http://localhost:11434',
        model: 'qwen3.5:0.8b',
        timeout: 120,
        backend: 'ollama' as const,
      },
      ...overrides,
    }
  }

  it('resolves a valid providerModelRef to the correct provider/model', () => {
    const config = makeConfig({
      visionFallback: {
        enabled: true,
        providerModelRef: 'vision-provider/gpt-4o-vision',
        timeout: 120,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.baseUrl).toBe('http://vision-server:8000/v1')
    expect(result!.model).toBe('gpt-4o-vision')
    expect(result!.timeout).toBe(120 * 1000)
    expect(result!.backend).toBe('openai')
    expect(result!.apiKey).toBe('sk-test-key-123')
  })

  it('falls back to legacy fields when providerModelRef is absent', () => {
    const config = makeConfig({
      visionFallback: {
        enabled: true,
        url: 'http://legacy-server:11434',
        model: 'llava',
        timeout: 60,
        backend: 'ollama' as const,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.baseUrl).toBe('http://legacy-server:11434')
    expect(result!.model).toBe('llava')
    expect(result!.timeout).toBe(60 * 1000)
    expect(result!.backend).toBe('ollama')
    expect(result!.apiKey).toBeUndefined()
  })

  it('passes the api key through when the manual config sets one', () => {
    const config = makeConfig({
      visionFallback: {
        enabled: true,
        url: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        timeout: 120,
        backend: 'openai' as const,
        apiKey: 'sk-manual-key',
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.baseUrl).toBe('https://api.openai.com/v1')
    expect(result!.backend).toBe('openai')
    expect(result!.apiKey).toBe('sk-manual-key')
  })

  it('keeps using the provider key when providerModelRef resolves', () => {
    const config = makeConfig({
      visionFallback: {
        enabled: true,
        providerModelRef: 'vision-provider/gpt-4o-vision',
        url: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        timeout: 120,
        backend: 'openai' as const,
        apiKey: 'sk-manual-key',
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.apiKey).toBe('sk-test-key-123')
  })

  it('handles provider-not-found gracefully by falling back to legacy', () => {
    const config = makeConfig({
      visionFallback: {
        enabled: true,
        providerModelRef: 'nonexistent-provider/gpt-4o-vision',
        url: 'http://fallback:11434',
        model: 'fallback-model',
        timeout: 30,
        backend: 'ollama' as const,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.baseUrl).toBe('http://fallback:11434')
    expect(result!.model).toBe('fallback-model')
  })

  it('handles model-not-found gracefully by falling back to first vision-capable model', () => {
    const config = makeConfig({
      visionFallback: {
        enabled: true,
        providerModelRef: 'vision-provider/nonexistent-model',
        timeout: 120,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.model).toBe('gpt-4o-vision')
    expect(result!.baseUrl).toBe('http://vision-server:8000/v1')
    expect(result!.backend).toBe('openai')
  })

  it('disables vision fallback when provider ref has no vision-capable models', () => {
    const noVisionProvider = {
      ...visionProvider,
      id: 'no-vision-provider',
      models: [{ id: 'text-model', contextWindow: 32000, source: 'backend' as const }],
    }
    const config = makeConfig({
      providers: [noVisionProvider],
      visionFallback: {
        enabled: true,
        providerModelRef: 'no-vision-provider/text-model',
        url: 'http://fallback:11434',
        model: 'fallback-model',
        timeout: 30,
        backend: 'ollama' as const,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.baseUrl).toBe('http://fallback:11434')
    expect(result!.model).toBe('fallback-model')
  })

  it('returns undefined when vision fallback is disabled', () => {
    const config = makeConfig({
      visionFallback: {
        enabled: false,
        providerModelRef: 'vision-provider/gpt-4o-vision',
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeUndefined()
  })

  it('includes apiKey when the provider has one', () => {
    const config = makeConfig({
      visionFallback: {
        enabled: true,
        providerModelRef: 'vision-provider/gpt-4o-mini',
        timeout: 120,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.apiKey).toBe('sk-test-key-123')
    expect(result!.model).toBe('gpt-4o-mini')
  })

  it('omits apiKey when the provider has none', () => {
    const providerNoKey = {
      ...visionProvider,
      apiKey: undefined,
    }
    const config = makeConfig({
      providers: [providerNoKey],
      visionFallback: {
        enabled: true,
        providerModelRef: 'vision-provider/gpt-4o-vision',
        timeout: 120,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.apiKey).toBeUndefined()
  })

  it('retains providerModelRef in config even when provider is missing (graceful degradation)', () => {
    const config = makeConfig({
      providers: [],
      visionFallback: {
        enabled: true,
        providerModelRef: 'deleted-provider/some-model',
        url: 'http://fallback:11434',
        model: 'fallback-model',
        timeout: 30,
        backend: 'ollama' as const,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.baseUrl).toBe('http://fallback:11434')
    expect(getVisionFallback(config).providerModelRef).toBe('deleted-provider/some-model')
  })

  it('falls back to default url when provider has no url and fallback.url is undefined', () => {
    const providerNoUrl = {
      ...visionProvider,
      url: '',
      apiKey: undefined,
    }
    const config = makeConfig({
      providers: [providerNoUrl],
      visionFallback: {
        enabled: true,
        providerModelRef: 'vision-provider/gpt-4o-vision',
        url: '',
        timeout: 60,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.baseUrl).toBe('http://localhost:11434')
    expect(result!.model).toBe('gpt-4o-vision')
    expect(result!.timeout).toBe(60 * 1000)
  })

  it('returns legacy fallback when providerModelRef is empty string', () => {
    const config = makeConfig({
      visionFallback: {
        enabled: true,
        providerModelRef: '',
        url: 'http://manual:11434',
        model: 'manual-model',
        timeout: 30,
        backend: 'ollama' as const,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.baseUrl).toBe('http://manual:11434')
    expect(result!.model).toBe('manual-model')
  })

  it('handles ref without slash gracefully', () => {
    const config = makeConfig({
      visionFallback: {
        enabled: true,
        providerModelRef: 'no-slash-here',
        url: 'http://fallback:11434',
        model: 'fallback-model',
        timeout: 30,
        backend: 'ollama' as const,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.baseUrl).toBe('http://fallback:11434')
    expect(result!.model).toBe('fallback-model')
  })

  it('handles empty provider models array', () => {
    const providerEmptyModels = {
      ...visionProvider,
      id: 'empty-models',
      models: [],
    }
    const config = makeConfig({
      providers: [providerEmptyModels],
      visionFallback: {
        enabled: true,
        providerModelRef: 'empty-models/gpt-4o-vision',
        url: 'http://fallback:11434',
        model: 'fallback-model',
        timeout: 30,
        backend: 'ollama' as const,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeDefined()
    expect(result!.baseUrl).toBe('http://fallback:11434')
    expect(result!.model).toBe('fallback-model')
  })

  it('returns undefined when fallback.url is undefined in legacy mode', () => {
    const config = makeConfig({
      visionFallback: {
        enabled: true,
        url: '',
        model: 'some-model',
        timeout: 30,
        backend: 'ollama' as const,
      },
    })
    const result = resolveVisionFallback(config)
    expect(result).toBeUndefined()
  })
})
