import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PluginUpdateChecker } from './update-checker.js'
import { NotificationService } from './notifications.js'
import { setSetting } from '../db/settings.js'
import { closeDatabase, initDatabase } from '../db/index.js'
import { loadConfig } from '../config.js'

describe('PluginUpdateChecker', () => {
  let configDirectory: string
  let notifications: NotificationService
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    configDirectory = await mkdtemp(join(tmpdir(), 'openfox-update-checker-'))
    await mkdir(join(configDirectory, 'plugins'), { recursive: true })
    notifications = new NotificationService()
  })

  afterEach(async () => {
    closeDatabase()
    await rm(configDirectory, { recursive: true, force: true })
  })

  it('maps intervals correctly', () => {
    const checker = new PluginUpdateChecker({ configDirectory, notifications, logger })
    expect(checker.getIntervalMs('1h')).toBe(3_600_000)
    expect(checker.getIntervalMs('6h')).toBe(21_600_000)
    expect(checker.getIntervalMs('24h')).toBe(86_400_000)
    expect(checker.getIntervalMs('startup')).toBeNull()
    expect(checker.getIntervalMs('unknown')).toBeNull()
  })

  it('reads settings from database', () => {
    const checker = new PluginUpdateChecker({ configDirectory, notifications, logger })
    setSetting(
      'notification_settings',
      JSON.stringify({ pluginUpdateNotificationEnabled: false, pluginUpdateCheckInterval: '24h' }),
    )
    const settings = checker.getSettings()
    expect(settings.pluginUpdateNotificationEnabled).toBe(false)
    expect(settings.pluginUpdateCheckInterval).toBe('24h')
  })

  it('checks npm plugin updates and emits notification when update is available', async () => {
    const pluginDir = join(configDirectory, 'plugins', 'test-plugin')
    await mkdir(pluginDir, { recursive: true })
    await writeFile(
      join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'test-plugin',
        version: '1.0.0',
        openfox: { apiVersion: 2, displayName: 'Test Plugin' },
      }),
    )

    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.2.0' }),
    })

    const emitSpy = vi.spyOn(notifications, 'emit')

    const checker = new PluginUpdateChecker({
      configDirectory,
      notifications,
      logger,
      fetcher: fetcher as unknown as typeof fetch,
    })

    const results = await checker.checkUpdates()
    expect(results).toHaveLength(1)
    expect(results[0]?.updateAvailable).toBe(true)
    expect(results[0]?.currentVersion).toBe('1.0.0')
    expect(results[0]?.latestVersion).toBe('1.2.0')
    expect(emitSpy).toHaveBeenCalledWith(
      'openfox',
      expect.objectContaining({
        title: { en: 'Update available: Test Plugin', fr: 'Mise à jour disponible : Test Plugin' },
      }),
    )

    // Verify subsequent check does not emit duplicate notification
    emitSpy.mockClear()
    await checker.checkUpdates()
    expect(emitSpy).not.toHaveBeenCalled()
  })

  it('discovers and checks scoped npm plugins in node_modules/@scope/pkg', async () => {
    const scopedDir = join(configDirectory, 'plugins', 'node_modules', '@openfox', 'scoped-plugin')
    await mkdir(scopedDir, { recursive: true })
    await writeFile(
      join(scopedDir, 'package.json'),
      JSON.stringify({
        name: '@openfox/scoped-plugin',
        version: '0.9.0',
        openfox: { apiVersion: 2, displayName: 'Scoped Plugin' },
      }),
    )

    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    })

    const emitSpy = vi.spyOn(notifications, 'emit')

    const checker = new PluginUpdateChecker({
      configDirectory,
      notifications,
      logger,
      fetcher: fetcher as unknown as typeof fetch,
    })

    const results = await checker.checkUpdates()
    expect(results).toHaveLength(1)
    expect(results[0]?.packageName).toBe('@openfox/scoped-plugin')
    expect(results[0]?.updateAvailable).toBe(true)
    expect(emitSpy).toHaveBeenCalledWith(
      'openfox',
      expect.objectContaining({
        title: { en: 'Update available: Scoped Plugin', fr: 'Mise à jour disponible : Scoped Plugin' },
      }),
    )
  })

  it('handles start and stop lifecycle gracefully', () => {
    setSetting(
      'notification_settings',
      JSON.stringify({ pluginUpdateNotificationEnabled: true, pluginUpdateCheckInterval: '6h' }),
    )
    const checker = new PluginUpdateChecker({ configDirectory, notifications, logger })
    checker.start()
    checker.stop()
  })
})
