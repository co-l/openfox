/**
 * Plugin System E2E Tests
 *
 * Loads a real v2 plugin package into the test config directory and exercises
 * the full lifecycle over REST/WS: contributions, RPC, notifications, an agent
 * turn calling a plugin tool with fetch parity, disable/enable and uninstall.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createTestClient,
  createTestProject,
  createTestServer,
  collectChatEvents,
  assertNoErrors,
  createProject,
  createSession,
  type TestClient,
  type TestProject,
  type TestServerHandle,
} from './utils/index.js'

const PLUGIN_NAME = 'e2e-hello-plugin'
const PLUGIN_DIR = join(process.cwd(), 'e2e', '.openfox-test', 'plugins', PLUGIN_NAME)
const PLUGIN_SOURCE_DIR = join(process.cwd(), 'e2e', '.openfox-test', 'plugin-sources', PLUGIN_NAME)

const PLUGIN_MANIFEST = JSON.stringify({
  name: PLUGIN_NAME,
  version: '1.2.3',
  type: 'module',
  openfox: {
    apiVersion: 2,
    entry: 'index.js',
    displayName: 'E2E Hello Plugin',
    description: 'Plugin fixture for the e2e suite',
    capabilities: ['tools', 'commands', 'skills', 'ui', 'notifications', 'rpc', 'hooks'],
  },
})

const PLUGIN_CODE = `
export function register(registry) {
  const { context } = registry

  registry.registerTool({
    name: 'glob',
    description: 'Plugin-provided file glob tool',
    parameters: { type: 'object', properties: { pattern: { type: 'string' } } },
    execute: async () => ({ success: true, output: 'plugin-glob-output' }),
  })

  registry.registerCommand({ id: 'plugin-hello', name: 'Plugin hello', prompt: 'Say hello' })

  registry.registerSkillSource({
    id: 'plugin-skills',
    label: { en: 'Plugin skills', fr: 'Compétences du plugin' },
    load: () => [{ id: 'plugin-skill', name: 'Plugin skill', description: 'From a plugin', prompt: 'Do it' }],
  })

  registry.registerUiAction({
    id: 'plugin-open',
    slot: 'header.actions',
    label: { en: 'Open plugin', fr: 'Ouvrir le plugin' },
    onActivate: { kind: 'rpc', method: 'ping' },
  })

  registry.registerUiPanel({
    id: 'plugin-panel',
    title: { en: 'Plugin panel', fr: 'Panneau du plugin' },
    kind: 'declarative',
    content: [{ type: 'text', text: { en: 'Hello from the plugin', fr: 'Bonjour du plugin' } }],
  })

  registry.registerSettings({
    fields: [
      { key: 'greeting', type: 'text', label: { en: 'Greeting', fr: 'Salutation' }, default: 'Hi' },
      { key: 'token', type: 'password', label: { en: 'Token', fr: 'Jeton' }, secret: true },
    ],
  })

  registry.registerRpc('ping', async () => 'pong')
  registry.registerRpc('notify', async () => {
    context.notify({
      title: { en: 'Plugin says hi', fr: 'Le plugin dit bonjour' },
      body: { en: 'Emitted from an RPC call', fr: 'Émis depuis un appel RPC' },
      level: 'success',
      actions: [
        { label: { en: 'Open plugin', fr: 'Ouvrir le plugin' }, onActivate: { kind: 'rpc', method: 'ping' } },
      ],
    })
    return 'notified'
  })
  registry.registerHook('turn.completed', () => {})
}
`

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return (await res.json()) as T
}

async function post(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('Plugin system', () => {
  let server: TestServerHandle
  let client: TestClient

  beforeAll(async () => {
    await mkdir(PLUGIN_DIR, { recursive: true })
    await writeFile(join(PLUGIN_DIR, 'package.json'), PLUGIN_MANIFEST)
    await writeFile(join(PLUGIN_DIR, 'index.js'), PLUGIN_CODE)
    await mkdir(PLUGIN_SOURCE_DIR, { recursive: true })
    await writeFile(join(PLUGIN_SOURCE_DIR, 'package.json'), PLUGIN_MANIFEST)
    await writeFile(join(PLUGIN_SOURCE_DIR, 'index.js'), PLUGIN_CODE)
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
    await rm(PLUGIN_DIR, { recursive: true, force: true })
    await rm(PLUGIN_SOURCE_DIR, { recursive: true, force: true })
  })

  beforeEach(async () => {
    client = await createTestClient({ url: server.wsUrl })
  })

  afterEach(async () => {
    await client.close()
  })

  it('loads the plugin and exposes its contributions', async () => {
    const list = await fetchJson<{
      plugins: { id: string; displayName: string; enabled: boolean; contributions: Record<string, number> }[]
      contributions: { actions: { pluginId: string }[]; panels: { pluginId: string }[] }
    }>(`${server.url}/api/plugins/list`)

    const plugin = list.plugins.find((candidate) => candidate.id === PLUGIN_NAME)
    expect(plugin).toBeDefined()
    expect(plugin!.displayName).toBe('E2E Hello Plugin')
    expect(plugin!.enabled).toBe(true)
    expect(plugin!.contributions['tools']).toBe(1)
    expect(plugin!.contributions['rpcMethods']).toBe(2)
    expect(plugin!.contributions['settingsFields']).toBe(2)
    expect(list.contributions.actions[0]!.pluginId).toBe(PLUGIN_NAME)
    expect(list.contributions.panels[0]!.pluginId).toBe(PLUGIN_NAME)
  })

  it('merges plugin commands and skills into the agent-facing registries', async () => {
    const commands = await fetchJson<{
      defaults: { id: string; pluginId?: string }[]
      userItems: { id: string; pluginId?: string }[]
    }>(`${server.url}/api/commands`)
    const pluginCommand = [...commands.defaults, ...commands.userItems].find((command) => command.id === 'plugin-hello')
    expect(pluginCommand).toBeDefined()
    expect(pluginCommand!.pluginId).toBe(PLUGIN_NAME)

    const skills = await fetchJson<{ items: { id: string }[] }>(`${server.url}/api/skills`)
    expect(skills.items.some((skill) => skill.id === 'plugin-skill')).toBe(true)
  })

  it('invokes RPC, masks secrets and broadcasts notifications', async () => {
    const ping = await post(`${server.url}/api/plugins/${PLUGIN_NAME}/rpc/ping`, { params: {} })
    expect((await ping.json()) as { result: string }).toEqual({ result: 'pong' })

    const put = await fetch(`${server.url}/api/plugins/${PLUGIN_NAME}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { greeting: 'Yo', token: 'top-secret' } }),
    })
    expect(put.status).toBe(200)
    const settings = await fetchJson<{ values: Record<string, unknown>; secretsSet: string[] }>(
      `${server.url}/api/plugins/${PLUGIN_NAME}/settings`,
    )
    expect(settings.values['greeting']).toBe('Yo')
    expect(settings.values['token']).toBeUndefined()
    expect(settings.secretsSet).toEqual(['token'])
    expect(JSON.stringify(settings)).not.toContain('top-secret')

    const notificationPromise = client.waitFor('plugin.notification')
    await post(`${server.url}/api/plugins/${PLUGIN_NAME}/rpc/notify`, { params: {} })
    const notification = (await notificationPromise) as { payload: { notification: { title: unknown } } }
    expect(notification.payload.notification.title).toEqual({
      en: 'Plugin says hi',
      fr: 'Le plugin dit bonjour',
    })

    const persisted = await fetchJson<{
      notifications: { title: unknown; actions?: { label: unknown }[] }[]
      unreadCount: number
    }>(`${server.url}/api/notifications`)
    expect(persisted.notifications).toHaveLength(1)
    expect(persisted.unreadCount).toBe(1)
    expect(persisted.notifications[0]!.actions?.[0]!.label).toEqual({
      en: 'Open plugin',
      fr: 'Ouvrir le plugin',
    })
  })

  it('lets an agent call a plugin tool with fetch parity', async () => {
    const testDir: TestProject = await createTestProject({ template: 'typescript' })
    try {
      const project = await createProject(server.url, { name: 'Plugin tool test', workdir: testDir.path })
      await mkdir(join(testDir.path, '.openfox', 'agents'), { recursive: true })
      await writeFile(
        join(testDir.path, '.openfox', 'agents', 'plugin-tester.agent.md'),
        `---\nid: plugin-tester\nname: Plugin Tester\ndescription: Uses the plugin tool\nsubagent: false\ncolor: '#3b82f6'\nallowedTools:\n  - glob\n  - step_done\n---\n\nUse the glob tool when asked.\n`,
      )
      const session = await createSession(server.url, { projectId: project.id })
      const modeRes = await fetch(`${server.url}/api/sessions/${session.id}/mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'plugin-tester' }),
      })
      expect(modeRes.ok).toBe(true)

      await client.send('session.load', { sessionId: session.id })
      await client.send('chat.send', { content: 'Please glob **/*.ts to find the TypeScript files' })

      const events = await collectChatEvents(client)
      assertNoErrors(events)
      const toolResults = events.get<{ tool: string; result: { output?: string } }>('chat.tool_result')
      const pluginResult = toolResults.find((event) => event.payload.tool === 'glob')
      expect(pluginResult).toBeDefined()
      expect(pluginResult!.payload.result.output).toContain('plugin-glob-output')

      const reloaded = await fetchJson<{
        messages: { toolCalls?: { tool: string; result?: { output?: string } }[] }[]
      }>(`${server.url}/api/sessions/${session.id}?full=true`)
      const streamed = JSON.stringify(toolResults.map((event) => event.payload.result))
      const fetched = JSON.stringify(reloaded)
      expect(fetched).toContain('plugin-glob-output')
      expect(streamed).toContain('plugin-glob-output')
    } finally {
      await testDir.cleanup()
    }
  })

  it('disables, re-enables and uninstalls the plugin at runtime', async () => {
    await post(`${server.url}/api/plugins/${PLUGIN_NAME}/disable`)
    const disabled = await fetchJson<{
      plugins: { id: string; enabled: boolean }[]
      contributions: { actions: unknown[] }
    }>(`${server.url}/api/plugins/list`)
    expect(disabled.plugins.find((p) => p.id === PLUGIN_NAME)!.enabled).toBe(false)
    expect(disabled.contributions.actions).toHaveLength(0)

    await post(`${server.url}/api/plugins/${PLUGIN_NAME}/enable`)
    const enabled = await fetchJson<{ contributions: { actions: unknown[] } }>(`${server.url}/api/plugins/list`)
    expect(enabled.contributions.actions).toHaveLength(1)

    await post(`${server.url}/api/plugins/${PLUGIN_NAME}/uninstall`)
    const gone = await fetchJson<{ plugins: { id: string }[] }>(`${server.url}/api/plugins/list`)
    expect(gone.plugins.find((p) => p.id === PLUGIN_NAME)).toBeUndefined()

    const installed = await post(`${server.url}/api/plugins/install`, { path: PLUGIN_SOURCE_DIR })
    expect(installed.status).toBe(200)
    const reinstalled = await fetchJson<{
      plugins: { id: string; enabled: boolean; contributions: Record<string, number> }[]
    }>(`${server.url}/api/plugins/list`)
    const plugin = reinstalled.plugins.find((p) => p.id === PLUGIN_NAME)
    expect(plugin).toBeDefined()
    expect(plugin!.enabled).toBe(true)
    expect(plugin!.contributions['tools']).toBe(1)
  })
})
