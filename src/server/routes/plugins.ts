import { Router } from 'express'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile, readdir, rm, rename } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProviderPluginRegistry } from '../../provider/index.js'
import type { ProviderPluginDiagnostic } from '../providers/plugins/index.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { isDirectoryEntry } from '../utils/fs.js'
import type { ProviderRegistry } from '../providers/plugins/registry.js'
import type { Config } from '../../shared/types.js'
import { serverT } from '../i18n.js'
import { getSetting, setSetting } from '../db/settings.js'

interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

import { openFolder } from '../utils/openFolder.js'

const execFileP = promisify(execFile)

function readPluginSettings(
  name: string,
  spec: ReturnType<ProviderRegistry['getPluginSettingsSpec']>,
): Record<string, unknown> {
  const raw = getSetting(`plugin_settings:${name}`)
  if (raw) {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  const defaults: Record<string, unknown> = {}
  if (spec?.fields) {
    for (const field of spec.fields) {
      if (field.defaultValue !== undefined) {
        defaults[field.key] = field.defaultValue
      }
    }
  }
  return defaults
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
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to open folder' })
  }
}

export function createPluginRoutes(options: {
  config: Config
  providerAdapters: ProviderRegistry
  pluginDiagnostics: ProviderPluginDiagnostic[]
  logger: Logger
}): Router {
  const router = Router()
  const { config, providerAdapters, pluginDiagnostics, logger } = options

  let registryCache: { data: unknown; ts: number } | null = null

  router.param('name', (_req, res, next, name) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      res.status(400).json({ error: serverT({ en: 'Invalid plugin name', fr: 'Nom de plugin invalide' }) })
      return
    }
    next()
  })

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

  router.post('/install', async (req, res) => {
    const { githubUrl } = req.body as { githubUrl?: string }
    if (!githubUrl || typeof githubUrl !== 'string') {
      return res.status(400).json({ error: serverT({ en: 'githubUrl is required', fr: 'githubUrl est requis' }) })
    }

    const parsed = githubUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\/|$)/)
    if (!parsed) {
      return res.status(400).json({ error: serverT({ en: 'Invalid GitHub URL', fr: 'URL GitHub invalide' }) })
    }

    const repoName = parsed[2]!.replace(/\.git$/, '')
    if (!/^[a-zA-Z0-9_-]+$/.test(repoName)) {
      return res.status(400).json({ error: serverT({ en: 'Invalid repository name', fr: 'Nom de dépôt invalide' }) })
    }

    const pluginsDir = join(getGlobalConfigDir(config.mode ?? 'production'), 'plugins')
    const targetDir = join(pluginsDir, repoName)

    const tmpDir = join(pluginsDir, `.${repoName}-tmp-${Date.now()}`)
    try {
      await execFileP('mkdir', ['-p', pluginsDir], { timeout: 5000 })
    } catch {
      return res.status(500).json({
        error: serverT({
          en: 'Failed to create plugins directory',
          fr: 'Échec de la création du répertoire des plugins',
        }),
      })
    }

    let gitOk = false
    try {
      const { stdout } = await execFileP('git', ['--version'], { timeout: 5000 })
      gitOk = stdout.includes('git version')
    } catch {
      // fall through
    }
    if (!gitOk) {
      return res.status(500).json({
        error: serverT({
          en: 'git is not installed or not found in PATH',
          fr: 'git n’est pas installé ou introuvable dans le PATH',
        }),
      })
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
        loadError = serverT({
          en: 'Failed to install/build plugin dependencies',
          fr: 'Échec de l’installation/du build des dépendances du plugin',
        })
        logger.error('Plugin build failed', { repoName, error: String(err) })
      }

      let hasSettings = false
      if (!loadError) {
        try {
          const manifest = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8'))
          const pluginEntry = manifest.openfox?.plugin as string | undefined
          const apiVersion = manifest.openfox?.apiVersion as number | undefined
          if (manifest.openfox?.hasSettings) hasSettings = true

          if (!pluginEntry || !manifest.name) {
            loadError = serverT({
              en: 'Plugin package.json is missing openfox.plugin or name field',
              fr: 'Le package.json du plugin ne contient pas le champ openfox.plugin ou name',
            })
          } else if (apiVersion !== 1) {
            loadError = serverT(
              {
                en: 'Unsupported plugin API version: {{version}}',
                fr: 'Version d’API de plugin non prise en charge : {{version}}',
              },
              { version: String(apiVersion) },
            )
          } else {
            const mod = (await import(pathToFileURL(join(targetDir, pluginEntry)).href)) as {
              register?: (registry: ProviderPluginRegistry) => void | Promise<void>
            }
            if (typeof mod.register !== 'function') {
              loadError = serverT({
                en: 'Plugin does not export register(registry)',
                fr: 'Le plugin n’exporte pas register(registry)',
              })
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
                registerSettings(spec) {
                  diagnostic.hasSettings = true
                  hasSettings = true
                  providerAdapters.registerSettingsForPlugin(manifest.name, spec)
                },
                registerSettingsForPlugin(packageName, spec) {
                  hasSettings = true
                  providerAdapters.registerSettingsForPlugin(packageName, spec)
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
          loadError =
            err instanceof Error
              ? err.message
              : serverT({ en: 'Failed to load plugin', fr: 'Échec du chargement du plugin' })
          logger.error('Plugin runtime load failed', { repoName, error: loadError })
        }
      }

      res.json({ success: true, loaded, loadError, path: targetDir, hasSettings })
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true })
      const msg = err instanceof Error ? err.message : serverT({ en: 'Clone failed', fr: 'Échec du clonage' })
      logger.error('Plugin install failed', { githubUrl, error: msg })
      res.status(500).json({ error: msg })
    }
  })

  router.get('/installed', async (_req, res) => {
    const pluginsDir = join(getGlobalConfigDir(config.mode ?? 'production'), 'plugins')
    try {
      const entries = await readdir(pluginsDir, { withFileTypes: true })
      const installed: { name: string; version: string | null; hasSettings: boolean }[] = []
      for (const entry of entries) {
        if (!(await isDirectoryEntry(pluginsDir, entry))) continue
        const pkgPath = join(pluginsDir, entry.name, 'package.json')
        let version: string | null = null
        let hasSettingsInPkg = false
        try {
          const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
          version = (pkg.version as string) ?? null
          hasSettingsInPkg = Boolean(pkg.openfox?.hasSettings)
        } catch {
          // ignore if package.json not found or invalid
        }
        const hasRegisteredSettings = Boolean(providerAdapters.getPluginSettingsSpec(entry.name))
        const diag = pluginDiagnostics.find((d) => d.packageName === entry.name)
        const hasSettings = hasSettingsInPkg || hasRegisteredSettings || Boolean(diag?.hasSettings)
        installed.push({ name: entry.name, version, hasSettings })
      }
      res.json({ installed })
    } catch {
      res.json({ installed: [] })
    }
  })

  router.get('/:name/settings', async (req, res) => {
    const name = req.params.name as string
    const spec = providerAdapters.getPluginSettingsSpec(name)
    let values: Record<string, unknown> = {}

    if (spec?.getSettings) {
      try {
        values = (await spec.getSettings()) ?? {}
      } catch (err) {
        logger.error('Failed to get plugin settings from plugin callback', { name, error: String(err) })
      }
    } else {
      values = readPluginSettings(name, spec)
    }

    const clientSpec = spec
      ? {
          title: spec.title,
          description: spec.description,
          fields: spec.fields,
          customUiUrl: spec.customUiUrl,
        }
      : null

    // Never echo password-type values back to the client. They are stored server-side
    // and only updated on POST when the client sends a non-empty value.
    const safeValues: Record<string, unknown> = { ...values }
    const configuredKeys: string[] = []
    if (spec?.fields) {
      for (const field of spec.fields) {
        if (field.type === 'password') {
          if (values[field.key]) {
            configuredKeys.push(field.key)
          }
          delete safeValues[field.key]
        }
      }
    }

    res.json({
      name,
      hasSpec: Boolean(spec),
      spec: clientSpec,
      values: safeValues,
      configuredKeys,
    })
  })

  router.post('/:name/settings', async (req, res) => {
    const name = req.params.name as string
    const { values } = req.body as { values?: Record<string, unknown> }
    if (!values || typeof values !== 'object') {
      return res
        .status(400)
        .json({ error: serverT({ en: 'values object is required', fr: 'L’objet values est requis' }) })
    }

    const spec = providerAdapters.getPluginSettingsSpec(name)

    let existingValues: Record<string, unknown> = {}
    const raw = getSetting(`plugin_settings:${name}`)
    if (raw) {
      try {
        existingValues = JSON.parse(raw) as Record<string, unknown>
      } catch {
        existingValues = {}
      }
    }

    // Server-side required-field validation
    if (spec?.fields) {
      for (const field of spec.fields) {
        if (!field.required) continue
        const v = values[field.key]
        if (field.type === 'boolean') {
          if (v === undefined || v === null) {
            return res.status(400).json({
              error: serverT({ en: '{{label}} is required', fr: '{{label}} est requis' }, { label: field.label }),
            })
          }
        } else if (field.type === 'password') {
          const hasExisting = Boolean(existingValues[field.key])
          if (!hasExisting && (v === undefined || v === null || v === '')) {
            return res.status(400).json({
              error: serverT({ en: '{{label}} is required', fr: '{{label}} est requis' }, { label: field.label }),
            })
          }
        } else {
          if (v === undefined || v === null || v === '') {
            return res.status(400).json({
              error: serverT({ en: '{{label}} is required', fr: '{{label}} est requis' }, { label: field.label }),
            })
          }
        }
      }
    }

    // Merge with existing stored values so empty password fields keep their previous secret
    let mergedValues = values
    if (spec?.fields && spec.fields.some((f) => f.type === 'password')) {
      if (raw) {
        try {
          mergedValues = { ...existingValues }
          for (const [k, v] of Object.entries(values)) {
            // Only overwrite the stored secret when the client sends a non-empty value
            if (spec.fields.find((f) => f.key === k)?.type === 'password' && (v === '' || v === null)) {
              continue
            }
            mergedValues[k] = v
          }
        } catch {
          mergedValues = values
        }
      }
    }

    setSetting(`plugin_settings:${name}`, JSON.stringify(mergedValues))

    if (spec?.saveSettings) {
      try {
        await spec.saveSettings(mergedValues)
      } catch (err) {
        logger.error('Failed to save plugin settings via plugin callback', { name, error: String(err) })
        return res.status(500).json({
          error:
            err instanceof Error
              ? err.message
              : serverT({ en: 'Save settings failed', fr: 'Échec de l’enregistrement des paramètres' }),
        })
      }
    }

    res.json({ success: true, values: mergedValues })
  })

  router.get('/open-folder', async (_req, res) => {
    const pluginsDir = join(getGlobalConfigDir(config.mode ?? 'production'), 'plugins')
    await openFolderRoute(pluginsDir, res)
  })

  router.get('/:name/open-folder', async (req, res) => {
    const name = req.params.name as string
    const targetDir = join(getGlobalConfigDir(config.mode ?? 'production'), 'plugins', name)
    await openFolderRoute(targetDir, res)
  })

  router.delete('/:name', async (req, res) => {
    const name = req.params.name as string
    const targetDir = join(getGlobalConfigDir(config.mode ?? 'production'), 'plugins', name)
    try {
      await rm(targetDir, { recursive: true, force: true })
      for (let i = pluginDiagnostics.length - 1; i >= 0; i--) {
        if (pluginDiagnostics[i]!.source === targetDir) pluginDiagnostics.splice(i, 1)
      }
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : serverT({ en: 'Failed to remove plugin', fr: 'Échec de la suppression du plugin' }),
      })
    }
  })

  return router
}
