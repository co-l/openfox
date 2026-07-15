import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadProviderPlugins } from './loader.js'
import { ProviderRegistry } from './registry.js'

describe('loadProviderPlugins', () => {
  let tempDir: string
  let pluginDir: string
  let registry: ProviderRegistry

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openfox-plugin-test-'))
    pluginDir = join(tempDir, 'plugins')
    registry = new ProviderRegistry({ mode: 'production', configDirectory: tempDir })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns empty diagnostics when no plugins directory exists', async () => {
    const diagnostics = await loadProviderPlugins({ registry, configDirectory: tempDir, cwd: '/nonexistent' })
    expect(diagnostics).toEqual([])
  })

  it('skips packages without openfox.plugin field in package.json', async () => {
    const pkgDir = join(pluginDir, 'some-unrelated-package')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: 'some-unrelated-package', version: '1.0.0' }))
    const diagnostics = await loadProviderPlugins({ registry, configDirectory: tempDir, cwd: '/nonexistent' })
    expect(diagnostics).toEqual([])
  })

  it('skips packages with unsupported apiVersion', async () => {
    const pkgDir = join(pluginDir, 'bad-version-plugin')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: 'bad-version-plugin',
        version: '0.0.1',
        openfox: { apiVersion: 99, plugin: 'index.js' },
      }),
    )
    await writeFile(join(pkgDir, 'index.js'), 'export function register() {}')
    const diagnostics = await loadProviderPlugins({ registry, configDirectory: tempDir, cwd: '/nonexistent' })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.loaded).toBe(false)
    expect(diagnostics[0]!.error).toContain('Unsupported OpenFox plugin API version: 99')
  })

  it('loads a plugin that exports register()', async () => {
    const pkgDir = join(pluginDir, 'good-plugin')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: 'good-plugin',
        version: '1.2.3',
        openfox: { apiVersion: 1, plugin: 'index.js' },
      }),
    )
    await writeFile(
      join(pkgDir, 'index.js'),
      `export function register(registry) {
        registry.registerAuth({
          id: 'test-auth',
          beginLogin: async () => ({ challenge: { mode: 'external', verificationUrl: 'https://example.com', instructions: 'Go' }, completion: Promise.resolve({ credentialRef: 'ref' }) }),
          getStatus: async () => ({ state: 'connected' }),
          getAccessContext: async () => ({}),
          logout: async () => undefined,
        });
        registry.registerTransport({
          id: 'test-transport',
          listModels: async () => [],
          complete: async () => ({ id: '1', content: '', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
          stream: async function* () {},
        });
        registry.registerPreset({
          id: 'test-preset',
          name: 'Test Provider',
          description: 'A test provider',
          requiresAuth: true,
          authAdapter: 'test-auth',
          transportAdapter: 'test-transport',
          defaults: { url: 'https://api.example.com', backend: 'openai' },
        });
      }`,
    )
    const diagnostics = await loadProviderPlugins({ registry, configDirectory: tempDir, cwd: '/nonexistent' })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.loaded).toBe(true)
    expect(diagnostics[0]!.packageName).toBe('good-plugin')
    expect(diagnostics[0]!.version).toBe('1.2.3')
    expect(diagnostics[0]!.authAdapters).toEqual(['test-auth'])
    expect(diagnostics[0]!.transportAdapters).toEqual(['test-transport'])
    expect(diagnostics[0]!.presets).toEqual(['test-preset'])

    // Verify adapters were registered in the actual registry
    expect(registry.getAuth('test-auth')?.id).toBe('test-auth')
    expect(registry.getTransport('test-transport')?.id).toBe('test-transport')
    expect(registry.getPresets()).toHaveLength(1)
    expect(registry.getPresets()[0]!.id).toBe('test-preset')
  })

  it('captures errors when plugin register() throws', async () => {
    const pkgDir = join(pluginDir, 'broken-plugin')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: 'broken-plugin',
        version: '0.1.0',
        openfox: { apiVersion: 1, plugin: 'index.js' },
      }),
    )
    await writeFile(join(pkgDir, 'index.js'), `export function register() { throw new Error('Intentional failure'); }`)
    const diagnostics = await loadProviderPlugins({ registry, configDirectory: tempDir, cwd: '/nonexistent' })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.loaded).toBe(false)
    expect(diagnostics[0]!.error).toBe('Intentional failure')
  })

  it('captures errors when plugin does not export register()', async () => {
    const pkgDir = join(pluginDir, 'no-register-plugin')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: 'no-register-plugin',
        version: '1.0.0',
        openfox: { apiVersion: 1, plugin: 'index.js' },
      }),
    )
    await writeFile(join(pkgDir, 'index.js'), `export const foo = 'bar';`)
    const diagnostics = await loadProviderPlugins({ registry, configDirectory: tempDir, cwd: '/nonexistent' })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.loaded).toBe(false)
    expect(diagnostics[0]!.error).toContain('does not export register')
  })

  it('deduplicates plugins by package name across multiple roots', async () => {
    // Create same package in config plugins dir
    const pkgDir1 = join(pluginDir, 'dup-plugin')
    await mkdir(pkgDir1, { recursive: true })
    await writeFile(
      join(pkgDir1, 'package.json'),
      JSON.stringify({
        name: 'dup-plugin',
        version: '1.0.0',
        openfox: { apiVersion: 1, plugin: 'index.js' },
      }),
    )
    await writeFile(
      join(pkgDir1, 'index.js'),
      `export function register(registry) {
        registry.registerAuth({
          id: 'dup-auth',
          beginLogin: async () => ({ challenge: { mode: 'external', verificationUrl: 'https://example.com', instructions: 'Go' }, completion: Promise.resolve({ credentialRef: 'ref' }) }),
          getStatus: async () => ({ state: 'connected' }),
          getAccessContext: async () => ({}),
          logout: async () => undefined,
        });
      }`,
    )

    // Create same package name in a second root (simulating node_modules)
    const secondRoot = join(tempDir, 'second-root', 'node_modules', 'dup-plugin')
    await mkdir(secondRoot, { recursive: true })
    await writeFile(
      join(secondRoot, 'package.json'),
      JSON.stringify({
        name: 'dup-plugin',
        version: '1.0.0',
        openfox: { apiVersion: 1, plugin: 'index.js' },
      }),
    )
    await writeFile(
      join(secondRoot, 'index.js'),
      `export function register(registry) {
        registry.registerAuth({
          id: 'dup-auth-second',
          beginLogin: async () => ({ challenge: { mode: 'external', verificationUrl: 'https://example.com', instructions: 'Go' }, completion: Promise.resolve({ credentialRef: 'ref' }) }),
          getStatus: async () => ({ state: 'connected' }),
          getAccessContext: async () => ({}),
          logout: async () => undefined,
        });
      }`,
    )

    // The config plugins root is scanned first, so it should be loaded from there
    const diagnostics = await loadProviderPlugins({
      registry,
      configDirectory: tempDir,
      cwd: join(tempDir, 'second-root'),
    })
    // Should only appear once due to deduplication
    const dupDiagnostics = diagnostics.filter((d) => d.packageName === 'dup-plugin')
    expect(dupDiagnostics).toHaveLength(1)
    expect(dupDiagnostics[0]!.loaded).toBe(true)
  })
})
