import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PluginRegistry } from './registry.js'
import {
  setPluginDangerLevels,
  getPluginDangerLevel,
  listPluginDangerLevels,
  clearPluginDangerLevels,
  evaluatePluginPathAccess,
} from './danger-levels.js'
import type { PluginDangerLevel } from '../../plugin/index.js'

describe('Plugin Danger Levels & Security Policies', () => {
  beforeEach(() => {
    clearPluginDangerLevels()
  })

  it('registers a custom danger level on PluginRegistry', () => {
    const registry = new PluginRegistry({ mode: 'development', configDirectory: '/tmp' })
    registry.beginPlugin('test-plugin', {
      id: 'test-plugin',
      version: '1.0.0',
      runtime: { mode: 'development', configDirectory: '/tmp' },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      storage: { get: vi.fn(), set: vi.fn() },
      settings: vi.fn().mockReturnValue({}),
      notify: vi.fn(),
      publish: vi.fn(),
    })

    const customDl: PluginDangerLevel = {
      id: 'custom-safe',
      label: { en: 'Custom Safe', fr: 'Personnalisé Sûr' },
      description: { en: 'Custom description', fr: 'Description personnalisée' },
      badgeTone: 'success',
      evaluatePathAccess: vi.fn().mockResolvedValue({ action: 'allow' }),
    }

    registry.registerDangerLevel(customDl)
    registry.endPlugin()

    const summary = registry.getContributionSummary('test-plugin')
    expect(summary.dangerLevels).toBe(1)

    const ui = registry.getUiContributions()
    expect(ui.dangerLevels).toHaveLength(1)
    expect(ui.dangerLevels?.[0]).toEqual({
      id: 'custom-safe',
      pluginId: 'test-plugin',
      label: { en: 'Custom Safe', fr: 'Personnalisé Sûr' },
      description: { en: 'Custom description', fr: 'Description personnalisée' },
      badgeTone: 'success',
    })

    const dangerLevels = registry.getDangerLevels()
    expect(dangerLevels).toHaveLength(1)
    expect(dangerLevels[0]?.dangerLevel.id).toBe('custom-safe')
  })

  it('evaluates path access via evaluatePluginPathAccess', async () => {
    const evaluateFn = vi.fn().mockResolvedValue({ action: 'deny', message: 'Custom rejection message' })
    setPluginDangerLevels([
      {
        pluginId: 'test-plugin',
        dangerLevel: {
          id: 'strict',
          label: { en: 'Strict', fr: 'Strict' },
          evaluatePathAccess: evaluateFn,
        },
      },
    ])

    expect(getPluginDangerLevel('strict')).toBeDefined()
    expect(listPluginDangerLevels()).toHaveLength(1)

    const result = await evaluatePluginPathAccess('strict', {
      paths: ['/etc/passwd'],
      workdir: '/app',
      sessionId: 'sess-1',
      tool: 'read_file',
    })

    expect(evaluateFn).toHaveBeenCalledWith({
      paths: ['/etc/passwd'],
      workdir: '/app',
      sessionId: 'sess-1',
      tool: 'read_file',
    })
    expect(result).toEqual({ action: 'deny', message: 'Custom rejection message' })
  })

  it('returns undefined when evaluating an unknown danger level', async () => {
    const result = await evaluatePluginPathAccess('unknown', {
      paths: ['/etc/passwd'],
      workdir: '/app',
      sessionId: 'sess-1',
      tool: 'read_file',
    })
    expect(result).toBeUndefined()
  })
})
