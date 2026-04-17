import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const { playNotificationMock } = vi.hoisted(() => ({
  playNotificationMock: vi.fn(),
}))

vi.mock('./sound', () => ({
  playNotification: playNotificationMock,
  playAchievement: vi.fn(),
  playIntervention: vi.fn(),
  playWaitingForUser: vi.fn(),
  playNewMessage: vi.fn(),
}))

const mockAudio = {
  play: vi.fn().mockReturnValue(Promise.resolve()),
  currentTime: 0,
  volume: 0.5,
}
vi.stubGlobal('Audio', vi.fn(() => mockAudio))

describe('sound integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should pass agent type through to notification settings', async () => {
    vi.mocked(playNotificationMock).mockImplementation((agent: any) => {
      console.log('playNotification called with:', agent)
    })
    
    const { useNotificationSettingsStore } = await import('../stores/notifications')
    
    useNotificationSettingsStore.setState({
      settings: {
        soundEnabled: true,
        browserNotificationEnabled: false,
        events: {
          complete: { soundEnabled: true, browserNotification: false, customSoundUrl: null },
          waiting_for_user: { soundEnabled: true, browserNotification: false, customSoundUrl: null },
          phase_done: { soundEnabled: true, browserNotification: false, customSoundUrl: null },
          phase_blocked: { soundEnabled: true, browserNotification: false, customSoundUrl: null },
          new_message: { soundEnabled: false, browserNotification: false, customSoundUrl: null },
        },
        agentOverrides: {
          'build': { complete: { soundEnabled: false } },
          'sub-agent': { complete: { soundEnabled: false } },
        },
      },
      loaded: true,
    })

    const { resolveEventConfig } = await import('../stores/notifications')
    
    const buildConfig = resolveEventConfig(useNotificationSettingsStore.getState().settings, 'complete', 'build')
    const subAgentConfig = resolveEventConfig(useNotificationSettingsStore.getState().settings, 'complete', 'sub-agent')
    const generalConfig = resolveEventConfig(useNotificationSettingsStore.getState().settings, 'complete', undefined)

    expect(buildConfig.soundEnabled).toBe(false)
    expect(subAgentConfig.soundEnabled).toBe(false)
    expect(generalConfig.soundEnabled).toBe(true)
  })
})