import { Router } from 'express'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { readFile, readdir, rm, rename } from 'node:fs/promises'
import { platform } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProviderPluginRegistry } from '../../provider/index.js'
import type { ProviderPluginDiagnostic } from '../providers/plugins/index.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import type { ProviderRegistry } from '../providers/plugins/registry.js'
import type { Config } from '../../shared/types.js'

interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

const execFileP = promisify(execFile)

export function createPluginRoutes(options: {
  config: Config
  providerAdapters: ProviderRegistry
  pluginDiagnostics: ProviderPluginDiagnostic[]
  logger: Logger
}): Router {
  const router = Router()
  const { config, providerAdapters, pluginDiagnostics, logger } = options

  let registryCache: { data: unknown; ts: number } | null = null

  router.get('/registry', async (_req, res) => {
    try {
      const now = Date.now()
      if (registryCache && now - registryCache.ts < 300_000) {
        return res.json({ plugins: registryCache.data })
      }
      const moduleDir = dirname(fileURLToPath(import.meta.url))
      const registryPath = resolve(moduleDir, '../../../plugins-registry.json')
      const data = JSON.parse(await readFile(registryPath, 'utf8'))
      registryCache = { data, ts: now }
      res.json({ plugins: data })
    } catch (err) {
      logger.error('Failed to load plugin registry', { error: String(err) })
      res.json({ plugins: [] })
    }
  })

  router.post('/install', async (req, res) => {
    const { githubUrl } = req.body as { githubUrl?: string }
    if (!githubUrl || typeof githubUrl !== 'string') {
      return res.status(400).json({ error: 'githubUrl is required' })
    }

    const parsed = githubUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\/|$)/)
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid GitHub URL' })
    }

    const repoName = parsed[2]!.replace(/\.git$/, '')
    if (!/^[a-zA-Z0-9_-]+$/.test(repoName)) {
      return res.status(400).json({ error: 'Invalid repository name' })
    }

    const pluginsDir = join(getGlobalConfigDir(config.mode ?? 'production'), 'plugins')
    const targetDir = join(pluginsDir, repoName)

    const tmpDir = join(pluginsDir, `.${repoName}-tmp-${Date.now()}`)
    try {
      await execFileP('mkdir', ['-p', pluginsDir], { timeout: 5000 })
    } catch {
      return res.status(500).json({ error: 'Failed to create plugins directory' })
    }

    let gitOk = false
    try {
      const { stdout } = await execFileP('git', ['--version'], { timeout: 5000 })
      gitOk = stdout.includes('git version')
    } catch {
      // fall through
    }
    if (!gitOk) {
      return res.status(500).json({ error: 'git is not installed or not found in PATH' })
    }

    try {
      const cloneUrl = githubUrl.replace(/\/$/, '') + '.git'
      await execFileP('git', ['clone', '--depth', '1', cloneUrl, tmpDir], { timeout: 60000 })
      await rm(targetDir, { recursive: true, force: true })
      await rename(tmpDir, targetDir)
      let loaded = false
      let loadError: string | undefined
      try {
        await execFileP('npm', ['install', '--no-audit', '--no-fund'], { cwd: targetDir, timeout: 120000 })
        await execFileP('npm', ['run', 'build'], { cwd: targetDir, timeout: 120000 })
      } catch (err) {
        loadError = 'Failed to install/build plugin dependencies'
        logger.error('Plugin build failed', { repoName, error: String(err) })
      }

      if (!loadError) {
        try {
          const manifest = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8'))
          const pluginEntry = manifest.openfox?.plugin as string | undefined
          const apiVersion = manifest.openfox?.apiVersion as number | undefined

          if (!pluginEntry || !manifest.name) {
            loadError = 'Plugin package.json is missing openfox.plugin or name field'
          } else if (apiVersion !== 1) {
            loadError = `Unsupported plugin API version: ${String(apiVersion)}`
          } else {
            const mod = (await import(pathToFileURL(join(targetDir, pluginEntry)).href)) as {
              register?: (registry: ProviderPluginRegistry) => void | Promise<void>
            }
            if (typeof mod.register !== 'function') {
              loadError = 'Plugin does not export register(registry)'
            } else {
              const diagnostic: ProviderPluginDiagnostic = {
                packageName: manifest.name,
                version: manifest.version,
                source: targetDir,
                loaded: false,
                authAdapters: [],
                transportAdapters: [],
                presets: [],
              }
              const trackingRegistry: ProviderPluginRegistry = {
                runtime: providerAdapters.runtime,
                registerAuth(adapter) {
                  providerAdapters.registerAuth(adapter)
                  diagnostic.authAdapters.push(adapter.id)
                },
                registerTransport(adapter) {
                  providerAdapters.registerTransport(adapter)
                  diagnostic.transportAdapters.push(adapter.id)
                },
                registerPreset(preset) {
                  providerAdapters.registerPreset(preset)
                  diagnostic.presets.push(preset.id)
                },
              }
              await mod.register(trackingRegistry)
              diagnostic.loaded = true
              pluginDiagnostics.push(diagnostic)
              loaded = true
              config.providers = providerAdapters.resolveProviders(config.providers ?? [])
            }
          }
        } catch (err) {
          loadError = err instanceof Error ? err.message : 'Failed to load plugin'
          logger.error('Plugin runtime load failed', { repoName, error: loadError })
        }
      }

      res.json({ success: true, loaded, loadError, path: targetDir })
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true })
      const msg = err instanceof Error ? err.message : 'Clone failed'
      logger.error('Plugin install failed', { githubUrl, error: msg })
      res.status(500).json({ error: msg })
    }
  })

  router.get('/installed', async (_req, res) => {
    const pluginsDir = join(getGlobalConfigDir(config.mode ?? 'production'), 'plugins')
    try {
      const entries = await readdir(pluginsDir, { withFileTypes: true })
      const installed: { name: string; version: string | null }[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const pkgPath = join(pluginsDir, entry.name, 'package.json')
        let version: string | null = null
        try {
          const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
          version = (pkg.version as string) ?? null
        } catch {
          // ignore if package.json not found or invalid
        }
        installed.push({ name: entry.name, version })
      }
      res.json({ installed })
    } catch {
      res.json({ installed: [] })
    }
  })

  router.get('/open-folder', async (_req, res) => {
    const pluginsDir = join(getGlobalConfigDir(config.mode ?? 'production'), 'plugins')
    try {
      await execFileP('mkdir', ['-p', pluginsDir], { timeout: 5000 })
      const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'explorer' : 'xdg-open'
      await execFileP(cmd, [pluginsDir], { timeout: 5000 })
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to open folder' })
    }
  })

  router.get('/:name/open-folder', async (req, res) => {
    const name = req.params.name as string
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'Invalid plugin name' })
    const targetDir = join(getGlobalConfigDir(config.mode ?? 'production'), 'plugins', name)
    try {
      const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'explorer' : 'xdg-open'
      await execFileP(cmd, [targetDir], { timeout: 5000 })
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to open folder' })
    }
  })

  router.delete('/:name', async (req, res) => {
    const name = req.params.name as string
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: 'Invalid plugin name' })
    }
    const targetDir = join(getGlobalConfigDir(config.mode ?? 'production'), 'plugins', name)
    try {
      await rm(targetDir, { recursive: true, force: true })
      for (let i = pluginDiagnostics.length - 1; i >= 0; i--) {
        if (pluginDiagnostics[i]!.source === targetDir) pluginDiagnostics.splice(i, 1)
      }
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to remove plugin' })
    }
  })

  return router
}
