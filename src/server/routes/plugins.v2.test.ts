import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPluginRoutes } from './plugins.js'
import { PluginHost } from '../plugins/host.js'
import { closeDatabase, initDatabase } from '../db/index.js'
import { loadConfig } from '../config.js'
import type { Config } from '../../shared/types.js'

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

async function writePlugin(configDirectory: string, name: string, body: string): Promise<void> {
  const dir = join(configDirectory, 'plugins', name)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '2.3.4', openfox: { apiVersion: 2, entry: 'index.js', displayName: 'Demo' } }),
  )
  await writeFile(join(dir, 'index.js'), `export function register(registry) { ${body} }`)
  await writeFile(join(dir, 'panel.html'), '<html><body>hi</body></html>')
}

describe('plugin routes (v2)', () => {
  let configDirectory: string
  let server: ReturnType<express.Express['listen']>
  let baseUrl: string
  let host: PluginHost

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)

    configDirectory = await mkdtemp(join(tmpdir(), 'openfox-plugin-routes-'))
    await writePlugin(
      configDirectory,
      'demo-plugin',
      `
      registry.registerTool({ name: 'demo_tool', description: 'Demo tool', parameters: {}, execute: async () => ({ success: true }) });
      registry.registerCommand({ id: 'demo-command', name: 'Demo command', prompt: 'Do it' });
      registry.registerUiAction({ id: 'open', slot: 'header.actions', label: { en: 'Open demo', fr: 'Ouvrir démo' }, onActivate: { kind: 'rpc', method: 'ping' } });
      registry.registerUiPanel({ id: 'demo-panel', title: { en: 'Demo', fr: 'Démo' }, kind: 'iframe', url: 'panel.html' });
      registry.registerSettings({ fields: [
        { key: 'endpoint', type: 'text', label: { en: 'Endpoint', fr: 'Endpoint' } },
        { key: 'token', type: 'password', label: { en: 'Token', fr: 'Jeton' }, secret: true },
      ] });
      registry.registerRpc('ping', async () => 'pong');
      registry.registerAsset('panel.html');
      `,
    )

    host = new PluginHost({
      configDirectory,
      mode: 'production',
      logger,
      cwd: join(configDirectory, 'none'),
    })
    await host.start()

    const app = express()
    app.use(express.json())
    app.use('/api/plugins', createPluginRoutes({ config: { mode: 'production' } as Config, host, logger }))
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as { port: number }).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(configDirectory, { recursive: true, force: true })
    closeDatabase()
  })

  it('lists installed plugins with contribution summaries and UI contributions', async () => {
    const list = (await (await fetch(`${baseUrl}/api/plugins/list`)).json()) as {
      plugins: { id: string; displayName: string; enabled: boolean; contributions: { rpcMethods: number } }[]
      contributions: { actions: unknown[]; panels: unknown[] }
    }
    expect(list.plugins).toHaveLength(1)
    expect(list.plugins[0]!.id).toBe('demo-plugin')
    expect(list.plugins[0]!.displayName).toBe('Demo')
    expect(list.plugins[0]!.contributions.rpcMethods).toBe(1)
    expect(list.contributions.actions).toHaveLength(1)
    expect(list.contributions.panels).toHaveLength(1)

    const ui = (await (await fetch(`${baseUrl}/api/plugins/ui`)).json()) as {
      contributions: { actions: { label: unknown }[] }
    }
    expect(ui.contributions.actions[0]!.label).toEqual({ en: 'Open demo', fr: 'Ouvrir démo' })
  })

  it('disables and re-enables a plugin at runtime', async () => {
    const disabled = await fetch(`${baseUrl}/api/plugins/demo-plugin/disable`, { method: 'POST' })
    expect(disabled.status).toBe(200)
    const afterDisable = (await (await fetch(`${baseUrl}/api/plugins/list`)).json()) as {
      plugins: { enabled: boolean; contributions: { rpcMethods: number } }[]
      contributions: { actions: unknown[] }
    }
    expect(afterDisable.plugins[0]!.enabled).toBe(false)
    expect(afterDisable.contributions.actions).toHaveLength(0)

    await fetch(`${baseUrl}/api/plugins/demo-plugin/enable`, { method: 'POST' })
    const afterEnable = (await (await fetch(`${baseUrl}/api/plugins/list`)).json()) as {
      contributions: { actions: unknown[] }
    }
    expect(afterEnable.contributions.actions).toHaveLength(1)
  })

  it('round-trips settings while masking secrets', async () => {
    const put = await fetch(`${baseUrl}/api/plugins/demo-plugin/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { endpoint: 'https://api.test', token: 'super-secret' } }),
    })
    expect(put.status).toBe(200)
    const putBody = (await put.json()) as { values: Record<string, unknown>; secretsSet: string[] }
    expect(putBody.values['endpoint']).toBe('https://api.test')
    expect(putBody.values['token']).toBeUndefined()
    expect(putBody.secretsSet).toEqual(['token'])

    const get = await fetch(`${baseUrl}/api/plugins/demo-plugin/settings`)
    const getBody = (await get.json()) as { values: Record<string, unknown>; schema: { fields: unknown[] } }
    expect(getBody.schema.fields).toHaveLength(2)
    expect(JSON.stringify(getBody)).not.toContain('super-secret')

    const invalid = await fetch(`${baseUrl}/api/plugins/demo-plugin/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { endpoint: 42 } }),
    })
    expect(invalid.status).toBe(400)
  })

  it('invokes RPC methods and reports unknown ones', async () => {
    const ok = await fetch(`${baseUrl}/api/plugins/demo-plugin/rpc/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ params: {}, sessionId: 's1', workdir: '/tmp' }),
    })
    expect(ok.status).toBe(200)
    expect((await ok.json()) as { result: string }).toEqual({ result: 'pong' })

    const missing = await fetch(`${baseUrl}/api/plugins/demo-plugin/rpc/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    })
    expect(missing.status).toBe(400)
    expect(((await missing.json()) as { error: string }).error).toContain("no RPC method 'nope'")
  })

  it('serves only registered plugin assets', async () => {
    const asset = await fetch(`${baseUrl}/api/plugins/demo-plugin/assets/panel.html`)
    expect(asset.status).toBe(200)
    expect(await asset.text()).toContain('hi')

    const unregistered = await fetch(`${baseUrl}/api/plugins/demo-plugin/assets/package.json`)
    expect(unregistered.status).toBe(404)
  })

  it('uninstalls a plugin and removes it from the list', async () => {
    const res = await fetch(`${baseUrl}/api/plugins/demo-plugin/uninstall`, { method: 'POST' })
    expect(res.status).toBe(200)
    const list = (await (await fetch(`${baseUrl}/api/plugins/list`)).json()) as { plugins: unknown[] }
    expect(list.plugins).toHaveLength(0)
  })

  it('exposes diagnostics', async () => {
    const res = (await (await fetch(`${baseUrl}/api/plugins/diagnostics`)).json()) as {
      diagnostics: { packageName: string; loaded: boolean }[]
    }
    expect(res.diagnostics[0]).toMatchObject({ packageName: 'demo-plugin', loaded: true })
  })

  it('exposes plugin tools with provenance', async () => {
    const res = (await (await fetch(`${baseUrl}/api/plugins/tools`)).json()) as {
      tools: { name: string; description: string; pluginId: string }[]
    }
    expect(res.tools).toEqual([{ name: 'demo_tool', description: 'Demo tool', pluginId: 'demo-plugin' }])
  })

  it('inherits the app-wide auth gate for RPC endpoints', async () => {
    const app = express()
    app.use(express.json())
    app.use('/api', (req, res, next) => {
      if (req.headers['x-session-token'] !== 'valid-token') {
        return res.status(401).json({ error: 'Unauthorized' })
      }
      next()
    })
    app.use('/api/plugins', createPluginRoutes({ config: { mode: 'production' } as Config, host, logger }))
    const guarded = await new Promise<ReturnType<express.Express['listen']>>((resolve) => {
      const listening = app.listen(0, () => resolve(listening))
    })
    const port = (guarded.address() as { port: number }).port

    try {
      const unauthorized = await fetch(`http://localhost:${port}/api/plugins/demo-plugin/rpc/ping`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ params: {} }),
      })
      expect(unauthorized.status).toBe(401)

      const authorized = await fetch(`http://localhost:${port}/api/plugins/demo-plugin/rpc/ping`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-session-token': 'valid-token' },
        body: JSON.stringify({ params: {} }),
      })
      expect(authorized.status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => guarded.close(() => resolve()))
    }
  })
})
