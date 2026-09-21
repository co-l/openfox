import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../db/index.js'
import { loadConfig } from '../config.js'
import { PluginHost } from './host.js'
import { setPluginTools, createToolRegistry, getBuiltInToolNames } from '../tools/index.js'
import { enrichProvidersWithPluginMetadata } from './model-metadata.js'
import { evaluateConditionAsync, findMatchingTransitionAsync } from '../workflows/executor.js'
import type { ToolContext } from '../tools/types.js'
import type { Provider } from '../../shared/types.js'

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

async function writePlugin(configDirectory: string, name: string, body: string): Promise<void> {
  const dir = join(configDirectory, 'plugins', name)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', openfox: { apiVersion: 2, entry: 'index.js' } }),
  )
  await writeFile(join(dir, 'index.js'), `export function register(registry) { ${body} }`)
}

describe('plugin contributions integration', () => {
  let configDirectory: string

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    configDirectory = await mkdtemp(join(tmpdir(), 'openfox-plugin-integration-'))
    vi.clearAllMocks()
    setPluginTools([])
  })

  afterEach(async () => {
    setPluginTools([])
    await rm(configDirectory, { recursive: true, force: true })
    closeDatabase()
  })

  it('exposes plugin tools through the server tool registry with provenance', async () => {
    await writePlugin(
      configDirectory,
      'tool-plugin',
      `registry.registerTool({ name: 'plugin_echo', description: 'Echo args', parameters: { type: 'object', properties: { value: { type: 'string' } } }, execute: async (args) => ({ success: true, output: String(args.value) }) });`,
    )
    const host = new PluginHost({
      configDirectory,
      mode: 'production',
      logger,
      cwd: join(configDirectory, 'none'),
    })
    await host.start()

    expect(getBuiltInToolNames().has('plugin_echo')).toBe(false)
    const registry = createToolRegistry()
    expect(registry.tools.map((tool) => tool.name)).toContain('plugin_echo')

    const context = { workdir: '/tmp', sessionId: 's1', sessionManager: {} } as unknown as ToolContext
    const result = await registry.execute('plugin_echo', { value: 'hello' }, context)
    expect(result.success).toBe(true)
    expect(result.output).toBe('hello')
    expect(host.getPlugins()[0]!.contributions.tools).toBe(1)
  })

  it('merges plugin model metadata without mutating persisted provider config', async () => {
    await writePlugin(
      configDirectory,
      'pricing-plugin',
      `registry.registerModelMetadataProvider({ id: 'pricing', getMetadata: (ctx) => ctx.modelId === 'cheap-model' ? { pricing: { input: 0.1, output: 0.2, currency: 'USD', discountPercent: 50 }, badges: [{ label: { en: 'Cheap', fr: 'Pas cher' }, tone: 'success' }] } : undefined });`,
    )
    const host = new PluginHost({
      configDirectory,
      mode: 'production',
      logger,
      cwd: join(configDirectory, 'none'),
    })
    await host.start()

    const providers: Provider[] = [
      {
        id: 'p1',
        name: 'P1',
        url: 'https://api.test',
        backend: 'openai',
        models: [
          { id: 'cheap-model', contextWindow: 4096, source: 'backend' },
          { id: 'other-model', contextWindow: 4096, source: 'backend' },
        ],
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    const enriched = await enrichProvidersWithPluginMetadata(providers)

    expect(enriched[0]!.models[0]!.pluginMetadata?.pricing?.input).toBe(0.1)
    expect(enriched[0]!.models[0]!.pluginMetadata?.badges?.[0]!.tone).toBe('success')
    expect(enriched[0]!.models[1]!.pluginMetadata).toBeUndefined()
    expect(providers[0]!.models[0]!.pluginMetadata).toBeUndefined()
  })

  it('routes workflow transitions through plugin handlers', async () => {
    await writePlugin(
      configDirectory,
      'transition-plugin',
      `registry.registerTransitionHandler('needs_review', async (ctx) => ctx.config?.route === 'review');`,
    )
    const host = new PluginHost({
      configDirectory,
      mode: 'production',
      logger,
      cwd: join(configDirectory, 'none'),
    })
    await host.start()

    const transitions = [
      { when: { type: 'custom' as const, handler: 'needs_review', config: { route: 'review' } }, goto: 'review' },
      { when: { type: 'always' as const }, goto: 'done' },
    ]
    const fired = await findMatchingTransitionAsync(transitions, { result: 'pass', output: {} }, undefined, {
      workflowId: 'wf',
      stepId: 'build',
    })
    expect(fired?.goto).toBe('review')

    const fallback = await findMatchingTransitionAsync(
      [
        { when: { type: 'custom' as const, handler: 'needs_review', config: { route: 'other' } }, goto: 'review' },
        ...transitions.slice(1),
      ],
      { result: 'pass', output: {} },
    )
    expect(fallback?.goto).toBe('done')

    const missing = await evaluateConditionAsync({ type: 'custom', handler: 'not_registered' }, null)
    expect(missing).toBe(false)
  })
})
