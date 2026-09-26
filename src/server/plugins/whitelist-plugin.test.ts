import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { homedir } from 'node:os'
// @ts-expect-error - dynamic JS plugin import
import { register } from '../../../tmp/openfox-plugins/openfox-whitelist-plugin/src/index.js'
import type { PluginDangerLevel, PluginSettingsSchema } from '../../plugin/index.js'

describe('openfox-whitelist-plugin', () => {
  it('registers settings and two danger levels (whitelist & whitelist_only) with path access evaluation', () => {
    let registeredSettings: PluginSettingsSchema | undefined
    const registeredDls: PluginDangerLevel[] = []

    const mockSettings: Record<string, unknown> = {
      whitelistPaths: `/tmp/allowed\n~/shared-docs`,
      rejectionMessage: 'Custom forbidden message: do not retry.',
    }

    const mockRegistry = {
      context: {
        settings: vi.fn().mockImplementation(() => mockSettings),
      },
      registerSettings: vi.fn().mockImplementation((schema) => {
        registeredSettings = schema
      }),
      registerDangerLevel: vi.fn().mockImplementation((dl) => {
        registeredDls.push(dl)
      }),
    }

    register(mockRegistry as any)

    expect(mockRegistry.registerSettings).toHaveBeenCalledOnce()
    expect(registeredSettings?.fields).toHaveLength(2)
    expect(registeredSettings?.fields.map((f) => f.key)).toEqual(['whitelistPaths', 'rejectionMessage'])

    expect(mockRegistry.registerDangerLevel).toHaveBeenCalledTimes(2)

    const whitelistDl = registeredDls.find((dl) => dl.id === 'whitelist')
    expect(whitelistDl).toBeDefined()
    expect(whitelistDl?.label).toEqual({
      en: 'Whitelist',
      fr: 'Liste blanche',
    })

    const whitelistOnlyDl = registeredDls.find((dl) => dl.id === 'whitelist_only')
    expect(whitelistOnlyDl).toBeDefined()
    expect(whitelistOnlyDl?.label).toEqual({
      en: 'Whitelist Only',
      fr: 'Liste blanche uniquement',
    })

    // Mode 1: Whitelist tests
    // Allowed path
    expect(
      whitelistDl?.evaluatePathAccess?.({
        paths: ['/tmp/allowed/sub/file.txt'],
        workdir: '/my/project',
        sessionId: 's1',
        projectId: 'p1',
        tool: 'read_file',
      }),
    ).toEqual({ action: 'allow' })

    // Disallowed path in Whitelist mode -> asks user
    expect(
      whitelistDl?.evaluatePathAccess?.({
        paths: ['/etc/passwd'],
        workdir: '/my/project',
        sessionId: 's1',
        projectId: 'p1',
        tool: 'read_file',
      }),
    ).toEqual({ action: 'ask' })

    // Mode 2: Whitelist Only tests
    // Allowed path
    expect(
      whitelistOnlyDl?.evaluatePathAccess?.({
        paths: ['/tmp/allowed/sub/file.txt'],
        workdir: '/my/project',
        sessionId: 's1',
        projectId: 'p1',
        tool: 'read_file',
      }),
    ).toEqual({ action: 'allow' })

    // Allowed home path
    expect(
      whitelistOnlyDl?.evaluatePathAccess?.({
        paths: [join(homedir(), 'shared-docs', 'doc.pdf')],
        workdir: '/my/project',
        sessionId: 's1',
        projectId: 'p1',
        tool: 'read_file',
      }),
    ).toEqual({ action: 'allow' })

    // Disallowed path in Whitelist Only mode -> automatically denies with message
    expect(
      whitelistOnlyDl?.evaluatePathAccess?.({
        paths: ['/etc/passwd'],
        workdir: '/my/project',
        sessionId: 's1',
        projectId: 'p1',
        tool: 'read_file',
      }),
    ).toEqual({
      action: 'deny',
      message: 'Custom forbidden message: do not retry.',
    })

    // Empty whitelist in Whitelist mode -> asks user
    mockSettings['whitelistPaths'] = ''
    expect(
      whitelistDl?.evaluatePathAccess?.({
        paths: ['/tmp/allowed/file.txt'],
        workdir: '/my/project',
        sessionId: 's1',
        projectId: 'p1',
        tool: 'read_file',
      }),
    ).toEqual({ action: 'ask' })

    // Empty whitelist in Whitelist Only mode -> denies
    expect(
      whitelistOnlyDl?.evaluatePathAccess?.({
        paths: ['/tmp/allowed/file.txt'],
        workdir: '/my/project',
        sessionId: 's1',
        projectId: 'p1',
        tool: 'read_file',
      }),
    ).toEqual({
      action: 'deny',
      message: 'Custom forbidden message: do not retry.',
    })
  })

  it('loads through PluginHost and registers danger level and settings', async () => {
    const { PluginHost } = await import('./host.js')
    const { initDatabase, closeDatabase } = await import('../db/index.js')
    const { loadConfig } = await import('../config.js')
    const { tmpdir } = await import('node:os')
    const { rm } = await import('node:fs/promises')

    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    const configDirectory = join(tmpdir(), `openfox-wl-plugin-test-${Date.now()}`)
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    try {
      const host = new PluginHost({
        configDirectory,
        mode: 'production',
        logger,
        cwd: join(configDirectory, 'none'),
      })
      await host.start()

      const diagnostic = await host.installFromPath(
        join(process.cwd(), 'tmp', 'openfox-plugins', 'openfox-whitelist-plugin'),
      )
      expect(diagnostic.loaded).toBe(true)
      expect(diagnostic.error).toBeUndefined()

      const plugins = host.getPlugins()
      const plugin = plugins.find((p) => p.id === 'openfox-whitelist-plugin')
      expect(plugin).toBeDefined()
      expect(plugin?.contributions.dangerLevels).toBe(2)
      expect(plugin?.contributions.settingsFields).toBe(2)

      const uiContributions = host.getUiContributions()
      expect(uiContributions.dangerLevels?.some((dl) => dl.id === 'whitelist')).toBe(true)
      expect(uiContributions.dangerLevels?.some((dl) => dl.id === 'whitelist_only')).toBe(true)
    } finally {
      await rm(configDirectory, { recursive: true, force: true })
      closeDatabase()
    }
  })
})
