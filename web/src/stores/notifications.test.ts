import { describe, expect, it, vi, beforeEach } from 'vitest'

const { wsSendMock } = vi.hoisted(() => ({
  wsSendMock: vi.fn(() => 'message-id'),
}))

vi.mock('../lib/ws', () => ({
  wsClient: {
    send: wsSendMock,
    subscribe: vi.fn(() => () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(() => undefined),
    onStatusChange: vi.fn(() => undefined),
  },
}))

import {
  useNotificationSettingsStore,
  resolveEventConfig,
  DEFAULT_SETTINGS,
  type NotificationSettings,
} from './notifications'

describe('notifications store', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    useNotificationSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      loaded: false,
    })
  })

  it('starts with default settings', () => {
    const { settings } = useNotificationSettingsStore.getState()
    expect(settings.soundEnabled).toBe(true)
    expect(settings.browserNotificationEnabled).toBe(false)
    expect(settings.events.complete.soundEnabled).toBe(true)
    expect(settings.events.complete.browserNotification).toBe(false)
    expect(settings.events.complete.customSoundUrl).toBeNull()
  })

  it('updates a single event config', () => {
    useNotificationSettingsStore.getState().updateEvent('complete', { soundEnabled: false })
    const { settings } = useNotificationSettingsStore.getState()
    expect(settings.events.complete.soundEnabled).toBe(false)
    // Other events unchanged
    expect(settings.events.waiting_for_user.soundEnabled).toBe(true)
  })

  it('persists to server on update', () => {
    useNotificationSettingsStore.getState().updateEvent('complete', { soundEnabled: false })
    expect(wsSendMock).toHaveBeenCalledWith('settings.set', expect.objectContaining({
      key: 'notification_settings',
    }))
  })

  it('adds and removes agent overrides', () => {
    useNotificationSettingsStore.getState().updateAgentOverride('planner', 'complete', { soundEnabled: false })
    let { settings } = useNotificationSettingsStore.getState()
    expect(settings.agentOverrides.planner?.complete?.soundEnabled).toBe(false)

    // Remove override
    useNotificationSettingsStore.getState().updateAgentOverride('planner', 'complete', null)
    settings = useNotificationSettingsStore.getState().settings
    expect(settings.agentOverrides.planner).toBeUndefined()
  })
})

describe('resolveEventConfig', () => {
  it('returns base config when no agent override', () => {
    const settings: NotificationSettings = {
      ...DEFAULT_SETTINGS,
      events: {
        ...DEFAULT_SETTINGS.events,
        complete: { soundEnabled: true, browserNotification: true, customSoundUrl: null },
      },
    }
    const config = resolveEventConfig(settings, 'complete', 'planner')
    expect(config.soundEnabled).toBe(true)
    expect(config.browserNotification).toBe(true)
  })

  it('applies agent override over base config', () => {
    const settings: NotificationSettings = {
      ...DEFAULT_SETTINGS,
      events: {
        ...DEFAULT_SETTINGS.events,
        complete: { soundEnabled: true, browserNotification: true, customSoundUrl: null },
      },
      agentOverrides: {
        planner: {
          complete: { soundEnabled: false },
        },
      },
    }
    const config = resolveEventConfig(settings, 'complete', 'planner')
    expect(config.soundEnabled).toBe(false)
    // browserNotification falls through from base
    expect(config.browserNotification).toBe(true)
  })

  it('returns base config when no agent specified', () => {
    const settings: NotificationSettings = {
      ...DEFAULT_SETTINGS,
      agentOverrides: {
        planner: { complete: { soundEnabled: false } },
      },
    }
    const config = resolveEventConfig(settings, 'complete')
    expect(config.soundEnabled).toBe(true) // default, not overridden
  })
})
