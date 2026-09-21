import { Router } from 'express'
import { dirname, join, resolve, normalize, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Config } from '../../shared/types.js'
import { serverT } from '../i18n.js'
import { openFolder } from '../utils/openFolder.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { PluginHost } from '../plugins/host.js'
import { parseGithubUrl } from '../plugins/install.js'

interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

export interface PluginRoutesOptions {
  config: Config
  logger: Logger
  host?: PluginHost
}

const ID_PATTERN = /^[a-zA-Z0-9_@/.-]+$/

function pluginId(req: { params: Record<string, string | string[]> }): string {
  const raw = req.params['id']
  return typeof raw === 'string' ? raw : ''
}

function requireValidId(id: string, res: { status: (code: number) => { json: (body: unknown) => void } }): boolean {
  if (!ID_PATTERN.test(id) || id.split('/').includes('..')) {
    res.status(400).json({ error: serverT({ en: 'Invalid plugin name', fr: 'Nom de plugin invalide' }) })
    return false
  }
  return true
}

interface RouteResponse {
  json: (body: unknown) => void
  status: (code: number) => { json: (body: unknown) => void }
}

async function runForPluginId(
  req: { params: Record<string, string | string[]> },
  res: RouteResponse,
  handler: (id: string) => Promise<unknown>,
): Promise<void> {
  const id = pluginId(req)
  if (!requireValidId(id, res)) return
  try {
    res.json(await handler(id))
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

export function createPluginRoutes(options: PluginRoutesOptions): Router {
  const router = Router()
  const { config, logger } = options
  const host =
    options.host ??
    new PluginHost({
      configDirectory: getGlobalConfigDir(config.mode ?? 'production'),
      mode: config.mode === 'development' ? 'development' : 'production',
      logger,
    })

  let registryCache: { data: unknown; ts: number } | null = null

  router.get('/registry', async (_req, res) => {
    try {
      const now = Date.now()
      if (registryCache && now - registryCache.ts < 300_000) {
        return res.json({ plugins: registryCache.data })
      }
      const moduleDir = dirname(fileURLToPath(import.meta.url))
      let registryPath = resolve(moduleDir, '../plugins-registry.json')
      if (!existsSync(registryPath)) {
        registryPath = resolve(moduleDir, '../../../plugins-registry.json')
      }
      const data = JSON.parse(await readFile(registryPath, 'utf8'))
      registryCache = { data, ts: now }
      res.json({ plugins: data })
    } catch (err) {
      logger.error('Failed to load plugin registry', { error: String(err) })
      res.json({ plugins: [] })
    }
  })

  router.get('/list', (_req, res) => {
    res.json({ plugins: host.getPlugins(), contributions: host.getUiContributions() })
  })

  router.get('/ui', (_req, res) => {
    res.json({ contributions: host.getUiContributions() })
  })

  router.get('/diagnostics', (_req, res) => {
    res.json({ diagnostics: host.getDiagnostics() })
  })

  router.get('/tools', (_req, res) => {
    res.json({ tools: host.getPluginTools() })
  })

  router.post('/install', async (req, res) => {
    const body = req.body as { githubUrl?: unknown; npm?: unknown; path?: unknown }
    try {
      if (typeof body.githubUrl === 'string') {
        if (!body.githubUrl) {
          return res.status(400).json({ error: serverT({ en: 'githubUrl is required', fr: 'githubUrl est requis' }) })
        }
        try {
          parseGithubUrl(body.githubUrl)
        } catch (error) {
          return res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
        }
        const diagnostic = await host.installFromGithub(body.githubUrl)
        return res.json({ success: true, plugin: diagnostic })
      }
      if (typeof body.npm === 'string' && body.npm) {
        const diagnostic = await host.installFromNpm(body.npm)
        return res.json({ success: true, plugin: diagnostic })
      }
      if (typeof body.path === 'string' && body.path) {
        const diagnostic = await host.installFromPath(body.path)
        return res.json({ success: true, plugin: diagnostic })
      }
      return res.status(400).json({ error: serverT({ en: 'githubUrl is required', fr: 'githubUrl est requis' }) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Plugin install failed', { error: message })
      return res.status(500).json({ error: message })
    }
  })

  router.get('/open-folder', async (_req, res) => {
    await openFolderRoute(join(getGlobalConfigDir(config.mode ?? 'production'), 'plugins'), res)
  })

  router.get('/:id/open-folder', async (req, res) => {
    const id = pluginId(req)
    if (!requireValidId(id, res)) return
    const pluginsDir = join(getGlobalConfigDir(config.mode ?? 'production'), 'plugins')
    if (!isInsidePluginsDir(pluginsDir, id)) {
      return res.status(400).json({ error: serverT({ en: 'Invalid plugin name', fr: 'Nom de plugin invalide' }) })
    }
    await openFolderRoute(join(pluginsDir, id), res)
  })

  router.post('/:id/enable', (req, res) => {
    void runForPluginId(req, res, async (id) => {
      await host.enable(id)
      return { success: true, plugins: host.getPlugins() }
    })
  })

  router.post('/:id/disable', (req, res) => {
    void runForPluginId(req, res, async (id) => {
      await host.disable(id)
      return { success: true, plugins: host.getPlugins() }
    })
  })

  router.post('/:id/uninstall', (req, res) => {
    void runForPluginId(req, res, async (id) => {
      await host.uninstall(id)
      return { success: true, plugins: host.getPlugins() }
    })
  })

  router.get('/:id/settings', (req, res) => {
    const id = pluginId(req)
    if (!requireValidId(id, res)) return
    const scope = req.query['scope'] === 'project' ? 'project' : 'global'
    const projectId = typeof req.query['projectId'] === 'string' ? req.query['projectId'] : undefined
    const schema = host.getSettingsSchema(id)
    if (!schema) {
      return res
        .status(404)
        .json({ error: serverT({ en: 'Plugin has no settings', fr: 'Le plugin n’a pas de paramètres' }) })
    }
    const view = host.getSettingsView(id, scope, projectId)
    res.json({ schema, values: view.values, secretsSet: view.secretsSet })
  })

  router.put('/:id/settings', (req, res) => {
    const id = pluginId(req)
    if (!requireValidId(id, res)) return
    const body = req.body as {
      values?: Record<string, unknown>
      scope?: 'global' | 'project'
      projectId?: string
    }
    if (!body.values || typeof body.values !== 'object') {
      return res.status(400).json({ error: serverT({ en: 'values is required', fr: 'values est requis' }) })
    }
    const result = host.updateSettings(id, body.values, body.scope ?? 'global', body.projectId)
    if (result.errors.length > 0) return res.status(400).json({ error: result.errors.join('; ') })
    const view = host.getSettingsView(id, body.scope ?? 'global', body.projectId)
    res.json({ success: true, values: view.values, secretsSet: view.secretsSet })
  })

  router.post('/:id/rpc/:method', async (req, res) => {
    const id = pluginId(req)
    if (!requireValidId(id, res)) return
    const method = req.params['method'] as string
    const body = (req.body ?? {}) as {
      params?: Record<string, unknown>
      sessionId?: string
      workdir?: string
      projectId?: string
    }
    try {
      const result = await host.invokeRpc(id, method, body.params ?? {}, {
        sessionId: body.sessionId ?? '',
        workdir: body.workdir ?? process.cwd(),
        ...(body.projectId ? { projectId: body.projectId } : {}),
      })
      res.json({ result })
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  router.get('/:id/assets/*assetPath', async (req, res) => {
    const id = pluginId(req)
    if (!requireValidId(id, res)) return
    const record = host.getPlugins().find((plugin) => plugin.id === id)
    if (!record) return res.status(404).json({ error: serverT({ en: 'Plugin not found', fr: 'Plugin introuvable' }) })
    const rawPath = req.params['assetPath']
    const assetPath = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath ?? '')
    const registered = host.registry.getAssets(id)
    if (!registered.includes(assetPath)) {
      return res.status(404).json({ error: serverT({ en: 'Asset not found', fr: 'Ressource introuvable' }) })
    }
    const absolute = normalize(join(record.source, assetPath))
    if (!absolute.startsWith(normalize(record.source))) {
      return res.status(400).json({ error: serverT({ en: 'Invalid asset path', fr: 'Chemin de ressource invalide' }) })
    }
    try {
      const content = await readFile(absolute)
      res.setHeader('Content-Type', contentTypeFor(assetPath))
      res.send(content)
    } catch {
      res.status(404).json({ error: serverT({ en: 'Asset not found', fr: 'Ressource introuvable' }) })
    }
  })

  return router
}

async function openFolderRoute(
  dir: string,
  res: {
    json: (data: unknown) => void
    status: (code: number) => { json: (data: unknown) => void }
  },
): Promise<void> {
  try {
    await openFolder(dir)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : serverT({ en: 'Failed to open folder', fr: 'Échec de l’ouverture du dossier' }),
    })
  }
}

function isInsidePluginsDir(pluginsDir: string, id: string): boolean {
  const target = resolve(join(pluginsDir, id))
  return target === pluginsDir || target.startsWith(`${pluginsDir}${sep}`)
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.js')) return 'text/javascript'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.html')) return 'text/html'
  return 'text/plain'
}
