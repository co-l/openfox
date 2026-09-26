import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../db/index.js'
import { loadConfig } from '../config.js'
import { PluginHost } from './host.js'
import { emitPluginHook } from './hook-emitter.js'
import { listPluginModelMetadataProviders } from './model-metadata.js'
import { listPluginMessageTransforms } from './message-transforms.js'
import { listPluginTransitionHandlers, runPluginTransitionHandler } from './transition-handlers.js'
import { getAllSettings } from '../db/settings.js'

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

async function writePlugin(
  configDirectory: string,
  name: string,
  apiVersion: 1 | 2,
  body: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const dir = join(configDirectory, 'plugins', name)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      openfox: { apiVersion, entry: 'index.js', displayName: name, ...extra },
    }),
  )
  await writeFile(join(dir, 'index.js'), `export function register(registry) { ${body} }`)
  return dir
}

function makeHost(configDirectory: string, rpcTimeoutMs?: number): PluginHost {
  return new PluginHost({
    configDirectory,
    mode: 'production',
    logger,
    cwd: join(configDirectory, 'no-node-modules'),
    ...(rpcTimeoutMs ? { rpcTimeoutMs } : {}),
  })
}

describe('PluginHost', () => {
  let configDirectory: string

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    configDirectory = await mkdtemp(join(tmpdir(), 'openfox-plugin-host-'))
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await rm(configDirectory, { recursive: true, force: true })
    closeDatabase()
  })

  it('loads a v2 plugin and reports its contributions', async () => {
    await writePlugin(
      configDirectory,
      'demo-plugin',
      2,
      `
      registry.registerTool({ name: 'demo_tool', description: 'Demo', parameters: { type: 'object' }, execute: async () => ({ success: true, output: 'ok' }) });
      registry.registerCommand({ id: 'demo', name: 'Demo', prompt: 'do it' });
      registry.registerUiAction({ id: 'demo-action', slot: 'header.actions', label: { en: 'Demo', fr: 'Démo' }, onActivate: { kind: 'rpc', method: 'ping' } });
      registry.registerUiPanel({ id: 'demo-panel', title: { en: 'Demo panel', fr: 'Panneau démo' }, kind: 'declarative', content: [{ type: 'text', text: { en: 'Hi', fr: 'Salut' } }] });
      registry.registerUiComponent({ id: 'demo-comp', zone: 'sidebar.header', component: { type: 'text', text: { en: 'Injected', fr: 'Injecté' } } });
      registry.registerUiOverride({ id: 'demo-override', zone: 'header.brand', mode: 'hide' });
      registry.registerSettings({ fields: [{ key: 'token', type: 'password', label: { en: 'Token', fr: 'Jeton' }, secret: true }] });
      registry.registerRpc('ping', async () => 'pong');
      registry.registerHook('turn.completed', async () => {});
      `,
      { capabilities: ['tools', 'ui', 'settings', 'rpc', 'hooks'] },
    )

    const host = makeHost(configDirectory)
    const diagnostics = await host.start()

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.loaded).toBe(true)
    const info = host.getPlugins()[0]!
    expect(info.id).toBe('demo-plugin')
    expect(info.enabled).toBe(true)
    expect(info.contributions.tools).toBe(1)
    expect(info.contributions.commands).toBe(1)
    expect(info.contributions.uiActions).toBe(1)
    expect(info.contributions.uiPanels).toBe(1)
    expect(info.contributions.uiComponents).toBe(1)
    expect(info.contributions.uiOverrides).toBe(1)
    expect(info.contributions.rpcMethods).toBe(1)
    expect(info.contributions.hooks).toBe(1)
    expect(info.contributions.settingsFields).toBe(1)
    expect(host.getUiContributions().actions).toHaveLength(1)
    expect(host.getUiContributions().components).toHaveLength(1)
    expect(host.getUiContributions().overrides).toHaveLength(1)
  })

  it('keeps other plugins working when one register() throws', async () => {
    await writePlugin(configDirectory, 'broken-plugin', 2, `throw new Error('boom')`)
    await writePlugin(
      configDirectory,
      'healthy-plugin',
      2,
      `registry.registerTool({ name: 'healthy_tool', description: 'x', parameters: {}, execute: async () => ({ success: true }) });`,
    )

    const host = makeHost(configDirectory)
    const diagnostics = await host.start()

    const broken = diagnostics.find((d) => d.packageName === 'broken-plugin')!
    const healthy = diagnostics.find((d) => d.packageName === 'healthy-plugin')!
    expect(broken.loaded).toBe(false)
    expect(broken.error).toContain('boom')
    expect(healthy.loaded).toBe(true)
    expect(host.registry.getTools()).toHaveLength(1)
  })

  it('still loads v1 provider plugins', async () => {
    await writePlugin(
      configDirectory,
      'v1-plugin',
      1,
      `registry.registerPreset({ id: 'v1-preset', name: 'V1', description: 'v1', requiresAuth: false, defaults: { url: 'https://example.test', backend: 'openai' } });`,
    )

    const host = makeHost(configDirectory)
    const diagnostics = await host.start()

    expect(diagnostics[0]!.loaded).toBe(true)
    expect(host.registry.getPresets()).toHaveLength(1)
  })

  it('rejects duplicate contribution ids from different plugins', async () => {
    await writePlugin(
      configDirectory,
      'plugin-a',
      2,
      `registry.registerTool({ name: 'shared_tool', description: 'x', parameters: {}, execute: async () => ({ success: true }) });`,
    )
    await writePlugin(
      configDirectory,
      'plugin-b',
      2,
      `registry.registerTool({ name: 'b_only_tool', description: 'x', parameters: {}, execute: async () => ({ success: true }) });
       registry.registerTool({ name: 'shared_tool', description: 'x', parameters: {}, execute: async () => ({ success: true }) });`,
    )

    const host = makeHost(configDirectory)
    const diagnostics = await host.start()

    const pluginB = diagnostics.find((d) => d.packageName === 'plugin-b')!
    expect(pluginB.loaded).toBe(false)
    expect(pluginB.error).toContain('already registered')
    expect(host.registry.getTools()).toHaveLength(1)
    // A rejected plugin must not keep any of its already-registered contributions.
    expect(host.registry.getPluginIdFor('tool', 'b_only_tool')).toBeUndefined()
    expect(Object.values(host.registry.getContributionSummary('plugin-b')).every((count) => count === 0)).toBe(true)
  })

  it('rejects plugin tools that shadow built-in tool names', async () => {
    await writePlugin(
      configDirectory,
      'shadow-plugin',
      2,
      `registry.registerTool({ name: 'read_file', description: 'x', parameters: {}, execute: async () => ({ success: true }) });`,
    )

    const host = makeHost(configDirectory)
    const diagnostics = await host.start()

    expect(diagnostics[0]!.loaded).toBe(false)
    expect(diagnostics[0]!.error).toContain('collides with a built-in tool')
    expect(host.registry.getTools()).toHaveLength(0)
  })

  it('loads a v1 and a v2 plugin side by side', async () => {
    await writePlugin(
      configDirectory,
      'legacy-v1-plugin',
      1,
      `registry.registerPreset({ id: 'legacy-preset', name: 'Legacy', description: 'v1', requiresAuth: false, defaults: { url: 'https://legacy.test', backend: 'openai' } });`,
    )
    await writePlugin(
      configDirectory,
      'modern-v2-plugin',
      2,
      `registry.registerTool({ name: 'modern_tool', description: 'v2', parameters: {}, execute: async () => ({ success: true }) });`,
    )

    const host = makeHost(configDirectory)
    const diagnostics = await host.start()

    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.every((diagnostic) => diagnostic.loaded)).toBe(true)
    expect(host.registry.getPresets()).toHaveLength(1)
    expect(host.registry.getTools()).toHaveLength(1)
  })

  it('reports a missing entry point', async () => {
    const dir = join(configDirectory, 'plugins', 'no-entry-plugin')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'no-entry-plugin', version: '1.0.0', openfox: { apiVersion: 2 } }),
    )

    const host = makeHost(configDirectory)
    const diagnostics = await host.start()

    expect(diagnostics[0]!.loaded).toBe(false)
    expect(diagnostics[0]!.error).toContain('missing openfox.entry')
  })

  it('honors the manifest RPC timeout and requires the rpc capability', async () => {
    await writePlugin(
      configDirectory,
      'slow-plugin',
      2,
      `registry.registerRpc('slow', async () => new Promise((resolve) => setTimeout(() => resolve('late'), 200)));`,
      { timeoutMs: 40, capabilities: ['rpc'] },
    )
    await writePlugin(
      configDirectory,
      'no-rpc-capability-plugin',
      2,
      `registry.registerRpc('ping', async () => 'pong');`,
      { capabilities: ['tools'] },
    )

    const host = makeHost(configDirectory)
    await host.start()

    await expect(host.invokeRpc('slow-plugin', 'slow', {}, { sessionId: 's1', workdir: '/tmp' })).rejects.toThrow(
      'timed out after 40ms',
    )
    await expect(
      host.invokeRpc('no-rpc-capability-plugin', 'ping', {}, { sessionId: 's1', workdir: '/tmp' }),
    ).rejects.toThrow("does not declare the 'rpc' capability")
  })

  it('calls deactivate() when a plugin is disabled and uninstalled', async () => {
    const dir = await writePlugin(
      configDirectory,
      'lifecycle-plugin',
      2,
      `registry.registerTool({ name: 'lifecycle_tool', description: 'x', parameters: {}, execute: async () => ({ success: true }) });`,
    )
    await writeFile(
      join(dir, 'index.js'),
      `export function register(registry) {
        registry.registerTool({ name: 'lifecycle_tool', description: 'x', parameters: {}, execute: async () => ({ success: true }) });
      }
      export function deactivate() { globalThis.__deactivated = (globalThis.__deactivated ?? 0) + 1 }`,
    )

    const host = makeHost(configDirectory)
    await host.start()
    await host.disable('lifecycle-plugin')
    expect((globalThis as Record<string, unknown>)['__deactivated']).toBe(1)

    await host.enable('lifecycle-plugin')
    await host.uninstall('lifecycle-plugin')
    expect((globalThis as Record<string, unknown>)['__deactivated']).toBe(2)
  })

  it('reinstalls an installed plugin and reloads its diagnostic', async () => {
    await writePlugin(
      configDirectory,
      'reinstall-plugin',
      2,
      `registry.registerTool({ name: 'reinstall_tool', description: 'x', parameters: {}, execute: async () => ({ success: true }) });`,
    )
    const host = makeHost(configDirectory)
    await host.start()
    const diag = await host.reinstall('reinstall-plugin')
    expect(diag.loaded).toBe(true)
    expect(diag.packageName).toBe('reinstall-plugin')
  })

  it('refuses to uninstall plugins discovered outside the plugins directory', async () => {
    const cwd = join(configDirectory, 'app')
    const externalDir = join(cwd, 'node_modules', 'external-plugin')
    await mkdir(externalDir, { recursive: true })
    await writeFile(
      join(externalDir, 'package.json'),
      JSON.stringify({ name: 'external-plugin', version: '1.0.0', openfox: { apiVersion: 2, entry: 'index.js' } }),
    )
    await writeFile(
      join(externalDir, 'index.js'),
      `export function register(registry) { registry.registerTool({ name: 'external_tool', description: 'x', parameters: {}, execute: async () => ({ success: true }) }); }`,
    )

    const host = new PluginHost({ configDirectory, mode: 'production', logger, cwd })
    await host.start()

    const info = host.getPlugins().find((plugin) => plugin.id === 'external-plugin')
    expect(info).toBeDefined()
    expect(info!.removable).toBe(false)
    await expect(host.uninstall('external-plugin')).rejects.toThrow('cannot be removed by OpenFox')
    expect(host.getPlugins().some((plugin) => plugin.id === 'external-plugin')).toBe(true)
  })

  it('disables and re-enables a plugin without a restart', async () => {
    await writePlugin(
      configDirectory,
      'toggle-plugin',
      2,
      `registry.registerTool({ name: 'toggle_tool', description: 'x', parameters: {}, execute: async () => ({ success: true }) });
       registry.registerUiBadge({ id: 'toggle-badge', slot: 'session.row.badges', label: { en: 'On', fr: 'Actif' } });`,
    )
    const host = makeHost(configDirectory)
    await host.start()
    expect(host.registry.getTools()).toHaveLength(1)

    await host.disable('toggle-plugin')
    expect(host.registry.getTools()).toHaveLength(0)
    expect(host.getUiContributions().badges).toHaveLength(0)
    expect(host.getPlugins()[0]!.enabled).toBe(false)

    await host.enable('toggle-plugin')
    expect(host.registry.getTools()).toHaveLength(1)
    expect(host.getPlugins()[0]!.enabled).toBe(true)
  })

  it('persists the disabled list across host restarts', async () => {
    await writePlugin(
      configDirectory,
      'persist-plugin',
      2,
      `registry.registerTool({ name: 'persist_tool', description: 'x', parameters: {}, execute: async () => ({ success: true }) });`,
    )
    const first = makeHost(configDirectory)
    await first.start()
    await first.disable('persist-plugin')

    const second = makeHost(configDirectory)
    const diagnostics = await second.start()
    expect(diagnostics[0]!.loaded).toBe(false)
    expect(second.getPlugins()[0]!.enabled).toBe(false)
    expect(second.registry.getTools()).toHaveLength(0)
  })

  it('masks secrets in settings and validates writes', async () => {
    await writePlugin(
      configDirectory,
      'settings-plugin',
      2,
      `registry.registerSettings({ fields: [
        { key: 'endpoint', type: 'text', label: { en: 'Endpoint', fr: 'Endpoint' }, default: 'https://api.test' },
        { key: 'token', type: 'password', label: { en: 'Token', fr: 'Jeton' }, secret: true },
        { key: 'limit', type: 'number', label: { en: 'Limit', fr: 'Limite' }, required: true },
      ] });`,
    )
    const host = makeHost(configDirectory)
    await host.start()

    expect(host.updateSettings('settings-plugin', { token: 's3cret', limit: 5 })).toEqual({ errors: [] })
    const view = host.getSettingsView('settings-plugin')
    expect(view.values['endpoint']).toBe('https://api.test')
    expect(view.values['limit']).toBe(5)
    expect(view.values['token']).toBeUndefined()
    expect(view.secretsSet).toEqual(['token'])
    expect(JSON.stringify(view.values)).not.toContain('s3cret')

    expect(host.updateSettings('settings-plugin', { limit: 'nope' }).errors[0]).toContain('must be a number')
    expect(getAllSettings()['plugin.settings-plugin.global.token']).toBe('"s3cret"')

    // Updating other fields with secret omitted or masked retains existing secret even if required
    expect(host.updateSettings('settings-plugin', { limit: 10, token: '••••••••••••••••' })).toEqual({ errors: [] })
    expect(getAllSettings()['plugin.settings-plugin.global.token']).toBe('"s3cret"')
    expect(host.getSettingsView('settings-plugin').values['limit']).toBe(10)
  })

  it('never persists or exposes read-only settings fields', async () => {
    await writePlugin(
      configDirectory,
      'readonly-plugin',
      2,
      `registry.registerSettings({ fields: [
        { key: 'official', type: 'text', label: { en: 'Official', fr: 'Officiel' }, default: 'https://official.test', readOnly: true },
        { key: 'extra', type: 'text', label: { en: 'Extra', fr: 'Extra' } },
      ] });`,
    )
    const host = makeHost(configDirectory)
    await host.start()

    expect(host.updateSettings('readonly-plugin', { official: 'https://hacked.test', extra: 'kept' })).toEqual({
      errors: [],
    })
    expect(getAllSettings()['plugin.readonly-plugin.global.official']).toBeUndefined()
    expect(host.getSettingsView('readonly-plugin').values['official']).toBeUndefined()
    expect(host.getSettingsView('readonly-plugin').values['extra']).toBe('kept')
  })

  it('scopes plugin settings per project when requested', async () => {
    await writePlugin(
      configDirectory,
      'scoped-plugin',
      2,
      `registry.registerSettings({ fields: [{ key: 'mode', type: 'text', label: { en: 'Mode', fr: 'Mode' } }] });`,
    )
    const host = makeHost(configDirectory)
    await host.start()

    host.updateSettings('scoped-plugin', { mode: 'project-value' }, 'project', 'proj-1')
    host.updateSettings('scoped-plugin', { mode: 'global-value' }, 'global')

    expect(host.getSettingsView('scoped-plugin', 'global').values['mode']).toBe('global-value')
    expect(host.getSettingsView('scoped-plugin', 'project', 'proj-1').values['mode']).toBe('project-value')
  })

  it('invokes RPC handlers with timeout and structured errors', async () => {
    await writePlugin(
      configDirectory,
      'rpc-plugin',
      2,
      `registry.registerRpc('echo', async (params) => ({ echo: params.value }));
       registry.registerRpc('slow', async () => new Promise((resolve) => setTimeout(() => resolve('late'), 200)));`,
    )
    const host = makeHost(configDirectory, 50)
    await host.start()

    await expect(
      host.invokeRpc('rpc-plugin', 'echo', { value: 42 }, { sessionId: 's1', workdir: '/tmp' }),
    ).resolves.toEqual({
      echo: 42,
    })
    await expect(host.invokeRpc('rpc-plugin', 'missing', {}, { sessionId: 's1', workdir: '/tmp' })).rejects.toThrow(
      "no RPC method 'missing'",
    )
    await expect(host.invokeRpc('rpc-plugin', 'slow', {}, { sessionId: 's1', workdir: '/tmp' })).rejects.toThrow(
      'timed out',
    )
    await host.disable('rpc-plugin')
    await expect(host.invokeRpc('rpc-plugin', 'echo', {}, { sessionId: 's1', workdir: '/tmp' })).rejects.toThrow(
      'not enabled',
    )
  })

  it('persists notifications and broadcasts them', async () => {
    await writePlugin(
      configDirectory,
      'notify-plugin',
      2,
      `registry.context.notify({ title: { en: 'Build done', fr: 'Build terminé' }, level: 'success', actions: [{ label: { en: 'Retry', fr: 'Réessayer' }, onActivate: { kind: 'rpc', method: 'retry' } }] });`,
    )
    const host = makeHost(configDirectory)
    const broadcast = vi.fn()
    host.setBroadcaster(broadcast)
    await host.start()

    const list = host.notifications.list()
    expect(list.notifications).toHaveLength(1)
    expect(list.notifications[0]!.title).toEqual({ en: 'Build done', fr: 'Build terminé' })
    expect(list.notifications[0]!.actions?.[0]!.label).toEqual({ en: 'Retry', fr: 'Réessayer' })
    expect(list.notifications[0]!.actions?.[0]!.onActivate).toEqual({ kind: 'rpc', method: 'retry' })
    expect(list.unreadCount).toBe(1)
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'plugin.notification' }))

    host.notifications.markRead(list.notifications[0]!.id)
    expect(host.notifications.list().unreadCount).toBe(0)
    host.notifications.clear()
    expect(host.notifications.list().notifications).toHaveLength(0)
  })

  it('isolates throwing and slow hook handlers', async () => {
    await writePlugin(
      configDirectory,
      'hook-plugin',
      2,
      `registry.registerHook('turn.completed', () => { throw new Error('handler boom') });
       registry.registerHook('turn.completed', async () => new Promise((resolve) => setTimeout(resolve, 500)));`,
    )
    const host = makeHost(configDirectory)
    await host.start()

    await expect(host.hooks.emit('turn.completed', { sessionId: 's1', data: {} })).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      'Plugin hook failed',
      expect.objectContaining({ pluginId: 'hook-plugin', event: 'turn.completed' }),
    )
  }, 10000)

  it('registers transition handlers, commands, skills and model metadata', async () => {
    await writePlugin(
      configDirectory,
      'full-plugin',
      2,
      `registry.registerTransitionHandler('always_true', async () => true);
       registry.registerCommand({ id: 'plugin-cmd', name: 'Plugin command', prompt: 'hello' });
       registry.registerSkillSource({ id: 'src', label: { en: 'Skills', fr: 'Compétences' }, load: () => [{ id: 'plugin-skill', name: 'Plugin skill', description: 'd', prompt: 'p' }] });
       registry.registerModelMetadataProvider({ id: 'meta-provider', getMetadata: () => ({ nameTone: 'success', badges: [{ label: { en: 'Fast', fr: 'Rapide' } }] }) });`,
    )
    const host = makeHost(configDirectory)
    await host.start()

    expect(listPluginTransitionHandlers()).toEqual([{ name: 'always_true', pluginId: 'full-plugin' }])
    await expect(runPluginTransitionHandler('always_true', { outcome: null })).resolves.toBe(true)
    expect(host.registry.getCommands().map((c) => c.id)).toEqual(['plugin-cmd'])
    expect(host.registry.getSkillSources().map((s) => s.id)).toEqual(['src'])
    expect(listPluginModelMetadataProviders()).toHaveLength(1)

    await host.disable('full-plugin')
    expect(listPluginTransitionHandlers()).toEqual([])
    expect(listPluginModelMetadataProviders()).toHaveLength(0)
  })

  it('rejects a plugin whose transition handler name collides with another plugin', async () => {
    await writePlugin(
      configDirectory,
      'transition-plugin-a',
      2,
      `registry.registerTransitionHandler('review', () => true);`,
    )
    await writePlugin(
      configDirectory,
      'transition-plugin-b',
      2,
      `registry.registerTransitionHandler('review', () => false);`,
    )

    const host = makeHost(configDirectory)
    await host.start()

    const plugins = host.getPlugins()
    const a = plugins.find((plugin) => plugin.id === 'transition-plugin-a')
    const b = plugins.find((plugin) => plugin.id === 'transition-plugin-b')
    expect(a?.enabled).toBe(true)
    expect(b?.enabled).toBe(true)
    expect(b?.loaded).toBe(false)
    expect(b?.error).toContain("Plugin transition 'review' is already registered by 'transition-plugin-a'")

    expect(listPluginTransitionHandlers()).toEqual([{ name: 'review', pluginId: 'transition-plugin-a' }])
    await expect(runPluginTransitionHandler('review', { outcome: null })).resolves.toBe(true)
  })

  it('bridges stored events to plugin hooks', async () => {
    await writePlugin(
      configDirectory,
      'event-plugin',
      2,
      `registry.registerHook('turn.completed', async (payload) => { (globalThis.__hooks ??= []).push(payload); });
       registry.registerHook('workflow.step.completed', async (payload) => { (globalThis.__hooks ??= []).push(payload); });
       registry.registerHook('workflow.execution.changed', async (payload) => { (globalThis.__hooks ??= []).push(payload); });
       registry.registerHook('task.completed', async (payload) => { (globalThis.__hooks ??= []).push(payload); });`,
    )
    const host = makeHost(configDirectory)
    await host.start()

    const stored = (type: string, data: Record<string, unknown>, seq: number) => ({
      sessionId: 'session-1',
      type,
      data,
      seq,
      timestamp: Date.now(),
    })
    const events = {
      subscribeAll: () => ({
        iterator: (async function* () {
          yield stored('chat.done', { messageId: 'm1', reason: 'complete' }, 1)
          yield stored('chat.done', { messageId: 'm2', reason: 'step_done' }, 2)
          yield stored('workflow.execution_changed', { executionId: 'e1', workflowId: 'wf', status: 'running' }, 3)
          yield stored('task.completed', { summary: 'done', iterations: 1 }, 4)
        })(),
        unsubscribe: () => {},
      }),
    }
    host.attachEventStore(events as never)
    await vi.waitFor(() => {
      expect((globalThis as Record<string, unknown>)['__hooks']).toHaveLength(4)
    })

    expect((globalThis as Record<string, unknown>)['__hooks']).toMatchObject([
      { event: 'turn.completed', sessionId: 'session-1' },
      { event: 'workflow.step.completed', sessionId: 'session-1' },
      { event: 'workflow.execution.changed', sessionId: 'session-1' },
      { event: 'task.completed', sessionId: 'session-1' },
    ])
  })

  it('emits llm.completed through the global hook emitter', async () => {
    await writePlugin(
      configDirectory,
      'llm-hook-plugin',
      2,
      `registry.registerHook('llm.completed', async (payload) => { globalThis.__llmHook = payload; });`,
    )
    const host = makeHost(configDirectory)
    await host.start()

    emitPluginHook('llm.completed', {
      sessionId: 'session-llm',
      data: { providerId: 'openai-provider', model: 'mock-model' },
    })
    await vi.waitFor(() => {
      expect((globalThis as Record<string, unknown>)['__llmHook']).toMatchObject({
        event: 'llm.completed',
        sessionId: 'session-llm',
        data: { providerId: 'openai-provider', model: 'mock-model' },
      })
    })
  })

  it('stops update checker on host stop', async () => {
    const host = makeHost(configDirectory)
    const stopSpy = vi.spyOn(host.updateChecker, 'stop')
    await host.start()
    host.stop()
    expect(stopSpy).toHaveBeenCalled()
  })

  it('registers, applies, and cleans up message transforms on enable/disable', async () => {
    await writePlugin(
      configDirectory,
      'transform-plugin',
      2,
      `registry.registerMessageTransform({
        id: 'headroom_compressor',
        priority: 10,
        transform: (msgs) => msgs.map(m => ({ ...m, content: '[compressed] ' + m.content }))
      });`,
      { capabilities: ['transforms'] },
    )

    const host = makeHost(configDirectory)
    await host.start()

    expect(host.registry.getMessageTransforms()).toHaveLength(1)
    expect(host.getPlugins()[0]?.contributions.messageTransforms).toBe(1)
    expect(listPluginMessageTransforms()).toHaveLength(1)

    // Disable plugin
    await host.disable('transform-plugin')
    expect(host.registry.getMessageTransforms()).toHaveLength(0)
    expect(listPluginMessageTransforms()).toHaveLength(0)

    // Re-enable plugin
    await host.enable('transform-plugin')
    expect(host.registry.getMessageTransforms()).toHaveLength(1)
    expect(listPluginMessageTransforms()).toHaveLength(1)
  })

  it('keeps the original plugin owner when a UI component is re-registered at runtime', async () => {
    await writePlugin(
      configDirectory,
      'runtime-plugin',
      2,
      `
      globalThis.__runtimeRegistry = registry;
      registry.registerUiComponent({ id: 'runtime-comp', zone: 'header.actions', component: { type: 'stack', direction: 'row', children: [] } });
      `,
    )

    const host = makeHost(configDirectory)
    await host.start()

    const globals = globalThis as unknown as Record<string, unknown>
    const runtimeRegistry = globals['__runtimeRegistry'] as { registerUiComponent: (component: unknown) => void }
    delete globals['__runtimeRegistry']

    runtimeRegistry.registerUiComponent({
      id: 'runtime-comp',
      zone: 'header.actions',
      component: {
        type: 'button',
        label: { en: 'Open', fr: 'Ouvrir' },
        onActivate: { kind: 'openPanel', panelId: 'runtime-panel' },
      },
    })

    const component = host.getUiContributions().components.find((c) => c.id === 'runtime-comp')
    expect(component?.pluginId).toBe('runtime-plugin')
    expect(component?.component).toMatchObject({ type: 'button' })
  })

  it('rejects duplicate message transform IDs across plugins', async () => {
    await writePlugin(
      configDirectory,
      'plugin-t1',
      2,
      `registry.registerMessageTransform({
        id: 'shared_transform',
        transform: (msgs) => msgs
      });`,
    )
    await writePlugin(
      configDirectory,
      'plugin-t2',
      2,
      `registry.registerMessageTransform({
        id: 'shared_transform',
        transform: (msgs) => msgs
      });`,
    )

    const host = makeHost(configDirectory)
    const diagnostics = await host.start()

    const t2 = diagnostics.find((d) => d.packageName === 'plugin-t2')!
    expect(t2.loaded).toBe(false)
    expect(t2.error).toContain("Plugin messageTransform 'shared_transform' is already registered by 'plugin-t1'")
    expect(host.registry.getMessageTransforms()).toHaveLength(1)
  })
})
