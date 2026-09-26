import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { requestPathAccess, PathAccessDeniedError, isPathAllowed, clearAllowedPaths } from './path-security.js'
import { setPluginDangerLevels, clearPluginDangerLevels } from '../plugins/danger-levels.js'

describe('Path Security with Plugin Danger Levels', () => {
  const WORKDIR = '/app/project'
  const OUTSIDE_PATH = '/app/external/file.txt'
  const SESSION_ID = 'session-dl-test'

  beforeEach(() => {
    clearAllowedPaths(SESSION_ID)
    clearPluginDangerLevels()
  })

  afterEach(() => {
    clearAllowedPaths(SESSION_ID)
    clearPluginDangerLevels()
  })

  it('auto-approves outside paths when plugin danger level returns allow', async () => {
    setPluginDangerLevels([
      {
        pluginId: 'whitelist-plugin',
        dangerLevel: {
          id: 'whitelist',
          label: { en: 'Whitelist Only', fr: 'Liste blanche' },
          evaluatePathAccess: vi.fn().mockResolvedValue({ action: 'allow' }),
        },
      },
    ])

    const onEvent = vi.fn()
    await expect(
      requestPathAccess([OUTSIDE_PATH], WORKDIR, SESSION_ID, 'call-1', 'read_file', onEvent, 'whitelist'),
    ).resolves.toBeUndefined()

    // No modal event should be sent
    expect(onEvent).not.toHaveBeenCalled()
    // Path should be added to allowed paths
    expect(isPathAllowed(SESSION_ID, OUTSIDE_PATH)).toBe(true)
  })

  it('immediately denies access with custom message when plugin danger level returns deny', async () => {
    const customMsg = 'Document outside project is strictly forbidden.'
    setPluginDangerLevels([
      {
        pluginId: 'whitelist-plugin',
        dangerLevel: {
          id: 'whitelist',
          label: { en: 'Whitelist Only', fr: 'Liste blanche' },
          evaluatePathAccess: vi.fn().mockResolvedValue({ action: 'deny', message: customMsg }),
        },
      },
    ])

    const onEvent = vi.fn()
    await expect(
      requestPathAccess([OUTSIDE_PATH], WORKDIR, SESSION_ID, 'call-2', 'read_file', onEvent, 'whitelist'),
    ).rejects.toThrow(PathAccessDeniedError)

    // No modal event should be sent (immediate rejection without popup)
    expect(onEvent).not.toHaveBeenCalled()

    try {
      await requestPathAccess([OUTSIDE_PATH], WORKDIR, SESSION_ID, 'call-2', 'read_file', onEvent, 'whitelist')
    } catch (err) {
      expect(err).toBeInstanceOf(PathAccessDeniedError)
      expect((err as PathAccessDeniedError).customMessage).toBe(customMsg)
      expect((err as PathAccessDeniedError).message).toBe(customMsg)
    }
  })

  it('sub-agent: auto-approves outside paths when plugin danger level returns allow', async () => {
    setPluginDangerLevels([
      {
        pluginId: 'whitelist-plugin',
        dangerLevel: {
          id: 'whitelist',
          label: { en: 'Whitelist Only', fr: 'Liste blanche' },
          evaluatePathAccess: vi.fn().mockResolvedValue({ action: 'allow' }),
        },
      },
    ])

    const onEvent = vi.fn()
    await expect(
      requestPathAccess(
        [OUTSIDE_PATH],
        WORKDIR,
        SESSION_ID,
        'call-sub',
        'read_file',
        onEvent,
        'whitelist',
        undefined,
        true,
      ),
    ).resolves.toBeUndefined()

    expect(isPathAllowed(SESSION_ID, OUTSIDE_PATH)).toBe(true)
  })

  it('sub-agent: immediately denies with custom message when plugin danger level returns deny', async () => {
    const customMsg = 'Sub-agent denied.'
    setPluginDangerLevels([
      {
        pluginId: 'whitelist-plugin',
        dangerLevel: {
          id: 'whitelist',
          label: { en: 'Whitelist Only', fr: 'Liste blanche' },
          evaluatePathAccess: vi.fn().mockResolvedValue({ action: 'deny', message: customMsg }),
        },
      },
    ])

    const onEvent = vi.fn()
    try {
      await requestPathAccess(
        [OUTSIDE_PATH],
        WORKDIR,
        SESSION_ID,
        'call-sub-deny',
        'read_file',
        onEvent,
        'whitelist',
        undefined,
        true,
      )
      expect.unreachable('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PathAccessDeniedError)
      expect((err as PathAccessDeniedError).customMessage).toBe(customMsg)
    }
  })
})
