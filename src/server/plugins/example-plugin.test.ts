import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../db/index.js'
import { loadConfig } from '../config.js'
import { PluginHost } from './host.js'

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

/**
 * The shipped example plugin must be loadable by the real host, not just by its
 * own unit tests with a fake registry.
 */
describe('examples/hello-plugin', () => {
  let configDirectory: string

  beforeEach(() => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    configDirectory = join(tmpdir(), `openfox-example-plugin-${Date.now()}`)
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await rm(configDirectory, { recursive: true, force: true })
    closeDatabase()
  })

  it('loads through PluginHost.installFromPath and exposes its contributions', async () => {
    const host = new PluginHost({
      configDirectory,
      mode: 'production',
      logger,
      cwd: join(configDirectory, 'none'),
    })
    await host.start()

    const diagnostic = await host.installFromPath(join(process.cwd(), 'examples', 'hello-plugin'))
    expect(diagnostic.loaded).toBe(true)
    expect(diagnostic.error).toBeUndefined()

    const plugin = host.getPlugins().find((candidate) => candidate.id === 'openfox-hello-plugin')
    expect(plugin).toBeDefined()
    expect(plugin!.enabled).toBe(true)
    expect(plugin!.contributions.tools).toBe(1)
    expect(plugin!.contributions.commands).toBe(1)
    expect(plugin!.contributions.rpcMethods).toBe(1)
    expect(plugin!.contributions.transitions).toBe(1)
    expect(host.getPluginTools().map((tool) => tool.name)).toContain('hello_plugin_greet')

    await expect(
      host.invokeRpc('openfox-hello-plugin', 'notify', {}, { sessionId: 's1', workdir: '/tmp' }),
    ).resolves.toBe('ok')
  })
})
