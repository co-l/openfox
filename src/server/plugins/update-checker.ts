import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { NotificationService } from './notifications.js'
import type { HookLogger } from './hooks.js'
import { getSetting } from '../db/settings.js'

const execFileP = promisify(execFile)

export interface PluginUpdateCheckerOptions {
  configDirectory: string
  notifications: NotificationService
  logger: HookLogger
  fetcher?: typeof fetch
}

export interface PluginUpdateInfo {
  packageName: string
  displayName: string
  currentVersion?: string
  latestVersion?: string
  updateAvailable: boolean
}

export class PluginUpdateChecker {
  private timer: NodeJS.Timeout | null = null
  private readonly notifiedUpdates = new Set<string>()
  private readonly configDirectory: string
  private readonly notifications: NotificationService
  private readonly logger: HookLogger
  private readonly fetcher: typeof fetch

  constructor(options: PluginUpdateCheckerOptions) {
    this.configDirectory = options.configDirectory
    this.notifications = options.notifications
    this.logger = options.logger
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  }

  start(): void {
    this.stop()
    const settings = this.getSettings()
    if (!settings.pluginUpdateNotificationEnabled) return

    void this.checkUpdates()

    const intervalMs = this.getIntervalMs(settings.pluginUpdateCheckInterval)
    if (intervalMs) {
      this.timer = setInterval(() => {
        void this.checkUpdates()
      }, intervalMs)
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getIntervalMs(interval: string): number | null {
    switch (interval) {
      case '1h':
        return 3_600_000
      case '6h':
        return 21_600_000
      case '24h':
        return 86_400_000
      case 'startup':
      default:
        return null
    }
  }

  getSettings(): { pluginUpdateNotificationEnabled: boolean; pluginUpdateCheckInterval: string } {
    try {
      const raw = getSetting('notification_settings')
      if (raw) {
        const parsed = JSON.parse(raw) as {
          pluginUpdateNotificationEnabled?: boolean
          pluginUpdateCheckInterval?: string
        }
        return {
          pluginUpdateNotificationEnabled: parsed.pluginUpdateNotificationEnabled !== false,
          pluginUpdateCheckInterval: parsed.pluginUpdateCheckInterval ?? '1h',
        }
      }
    } catch {
      // Ignore settings read / JSON parse error
    }
    return {
      pluginUpdateNotificationEnabled: true,
      pluginUpdateCheckInterval: '1h',
    }
  }

  async checkUpdates(): Promise<PluginUpdateInfo[]> {
    const pluginsDir = join(this.configDirectory, 'plugins')
    const packageDirs = await this.discoverPluginDirectories(pluginsDir)
    const results: PluginUpdateInfo[] = []

    for (const packageDir of packageDirs) {
      try {
        const manifestRaw = await readFile(join(packageDir, 'package.json'), 'utf8').catch(() => null)
        if (!manifestRaw) continue
        const manifest = JSON.parse(manifestRaw) as {
          name?: string
          version?: string
          openfox?: { displayName?: string }
        }
        const packageName = manifest.name
        if (!packageName) continue
        const displayName = manifest.openfox?.displayName ?? manifest.name ?? packageName
        const currentVersion = manifest.version

        const isGit = await stat(join(packageDir, '.git')).catch(() => null)
        if (isGit?.isDirectory()) {
          const update = await this.checkGitUpdate(packageDir, packageName, displayName, currentVersion)
          if (update) {
            results.push(update)
            if (update.updateAvailable) {
              this.notifyUpdate(update)
            }
          }
        } else if (currentVersion) {
          const update = await this.checkNpmUpdate(packageName, displayName, currentVersion)
          if (update) {
            results.push(update)
            if (update.updateAvailable) {
              this.notifyUpdate(update)
            }
          }
        }
      } catch (err) {
        this.logger.debug('Failed to check plugin update', { plugin: packageDir, error: String(err) })
      }
    }

    return results
  }

  private async discoverPluginDirectories(pluginsDir: string): Promise<string[]> {
    const roots = [pluginsDir, join(pluginsDir, 'node_modules')]
    const directories: string[] = []
    const seen = new Set<string>()

    for (const root of roots) {
      let entries
      try {
        entries = await readdir(root, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.') || (root === pluginsDir && entry.name === 'node_modules')) continue
        const entryPath = join(root, entry.name)
        const isDirectory =
          entry.isDirectory() ||
          (entry.isSymbolicLink() && (await stat(entryPath).catch(() => undefined))?.isDirectory())
        if (!isDirectory) continue

        if (entry.name.startsWith('@')) {
          const scoped = await readdir(entryPath, { withFileTypes: true }).catch(() => [])
          for (const child of scoped) {
            if (child.name.startsWith('.')) continue
            const childPath = join(entryPath, child.name)
            const childIsDirectory =
              child.isDirectory() ||
              (child.isSymbolicLink() && (await stat(childPath).catch(() => undefined))?.isDirectory())
            if (childIsDirectory && !seen.has(childPath)) {
              seen.add(childPath)
              directories.push(childPath)
            }
          }
        } else if (!seen.has(entryPath)) {
          seen.add(entryPath)
          directories.push(entryPath)
        }
      }
    }

    return directories
  }

  private async checkGitUpdate(
    packageDir: string,
    packageName: string,
    displayName: string,
    currentVersion?: string,
  ): Promise<PluginUpdateInfo | null> {
    try {
      const { stdout: localHead } = await execFileP('git', ['-C', packageDir, 'rev-parse', 'HEAD'], { timeout: 5000 })
      const cleanLocal = localHead.trim()

      const { stdout: remoteOut } = await execFileP('git', ['-C', packageDir, 'ls-remote', 'origin', 'HEAD'], {
        timeout: 10000,
      })
      const remoteMatch = remoteOut.match(/^([0-9a-fA-F]{40})\s+/m)
      if (!remoteMatch) return null

      const cleanRemote = remoteMatch[1]!
      const updateAvailable = cleanLocal !== cleanRemote

      return {
        packageName,
        displayName,
        currentVersion: currentVersion ?? cleanLocal.slice(0, 7),
        latestVersion: cleanRemote.slice(0, 7),
        updateAvailable,
      }
    } catch {
      return null
    }
  }

  private async checkNpmUpdate(
    packageName: string,
    displayName: string,
    currentVersion: string,
  ): Promise<PluginUpdateInfo | null> {
    try {
      const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`
      const res = await this.fetcher(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return null
      const data = (await res.json()) as { version?: string }
      if (!data.version) return null
      const updateAvailable = data.version !== currentVersion
      return {
        packageName,
        displayName,
        currentVersion,
        latestVersion: data.version,
        updateAvailable,
      }
    } catch {
      return null
    }
  }

  private notifyUpdate(update: PluginUpdateInfo): void {
    const notifyKey = `${update.packageName}:${update.latestVersion ?? 'new'}`
    if (this.notifiedUpdates.has(notifyKey)) return
    this.notifiedUpdates.add(notifyKey)

    this.notifications.emit('openfox', {
      title: {
        en: `Update available: ${update.displayName}`,
        fr: `Mise à jour disponible : ${update.displayName}`,
      },
      body: {
        en: `A new version of "${update.displayName}" is available.`,
        fr: `Une nouvelle version de « ${update.displayName} » est disponible.`,
      },
      level: 'info',
      actions: [
        {
          label: { en: 'Plugins', fr: 'Plugins' },
          onActivate: { kind: 'openPanel', panelId: 'plugins' },
        },
      ],
    })
  }
}
