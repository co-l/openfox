import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ProviderPluginRegistry } from '../../../provider/index.js'

interface PluginManifest {
  name?: string
  version?: string
  openfox?: { apiVersion?: number; plugin?: string }
}

export interface ProviderPluginDiagnostic {
  packageName: string
  version?: string
  source: string
  loaded: boolean
  authAdapters: string[]
  transportAdapters: string[]
  presets: string[]
  error?: string
}

async function packageDirectories(root: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const directories: string[] = []
  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    const isDirectory =
      entry.isDirectory() || (entry.isSymbolicLink() && (await stat(entryPath).catch(() => undefined))?.isDirectory())
    if (!isDirectory) continue
    if (entry.name.startsWith('@')) {
      const scoped = await readdir(entryPath, { withFileTypes: true }).catch(() => [])
      for (const child of scoped) {
        const childPath = join(entryPath, child.name)
        const childIsDirectory =
          child.isDirectory() ||
          (child.isSymbolicLink() && (await stat(childPath).catch(() => undefined))?.isDirectory())
        if (childIsDirectory) directories.push(childPath)
      }
    } else {
      directories.push(entryPath)
    }
  }
  return directories
}

export async function loadProviderPlugins(options: {
  registry: ProviderPluginRegistry
  configDirectory: string
  cwd?: string
}): Promise<ProviderPluginDiagnostic[]> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  const roots = [
    join(options.configDirectory, 'plugins'),
    join(options.cwd ?? process.cwd(), 'node_modules'),
    resolve(moduleDirectory, 'node_modules'),
    resolve(moduleDirectory, '../../../../node_modules'),
  ]
  const seen = new Set<string>()
  const diagnostics: ProviderPluginDiagnostic[] = []

  for (const root of roots) {
    for (const packageDir of await packageDirectories(root)) {
      const manifestPath = join(packageDir, 'package.json')
      let manifest: PluginManifest
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PluginManifest
      } catch {
        continue
      }
      const plugin = manifest.openfox?.plugin
      const packageName = manifest.name
      if (!plugin || !packageName || seen.has(packageName)) continue
      seen.add(packageName)
      const diagnostic: ProviderPluginDiagnostic = {
        packageName,
        ...(manifest.version && { version: manifest.version }),
        source: packageDir,
        loaded: false,
        authAdapters: [],
        transportAdapters: [],
        presets: [],
      }
      diagnostics.push(diagnostic)
      if (manifest.openfox?.apiVersion !== 1) {
        diagnostic.error = `Unsupported OpenFox plugin API version: ${String(manifest.openfox?.apiVersion)}`
        continue
      }

      const trackingRegistry: ProviderPluginRegistry = {
        runtime: options.registry.runtime,
        registerAuth(adapter) {
          options.registry.registerAuth(adapter)
          diagnostic.authAdapters.push(adapter.id)
        },
        registerTransport(adapter) {
          options.registry.registerTransport(adapter)
          diagnostic.transportAdapters.push(adapter.id)
        },
        registerPreset(preset) {
          options.registry.registerPreset(preset)
          diagnostic.presets.push(preset.id)
        },
      }
      try {
        const module = (await import(pathToFileURL(join(packageDir, plugin)).href)) as {
          register?: (registry: ProviderPluginRegistry) => Promise<void> | void
        }
        if (typeof module.register !== 'function') throw new Error('Plugin does not export register(registry)')
        await module.register(trackingRegistry)
        diagnostic.loaded = true
      } catch (error) {
        diagnostic.error = error instanceof Error ? error.message : String(error)
      }
    }
  }

  return diagnostics
}
