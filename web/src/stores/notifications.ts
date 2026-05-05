import { create } from 'zustand'
import { useSettingsStore, SETTINGS_KEYS } from './settings'

// Sound event types
export type SoundEvent = 'complete' | 'waiting_for_user' | 'phase_done' | 'phase_blocked' | 'new_message'

// Agent types that can have per-agent overrides
export type AgentType = 'planner' | 'build' | 'sub-agent'

// Settings for a single event
export interface EventNotificationConfig {
  soundEnabled: boolean
  browserNotification: boolean
  customSoundUrl: string | null // null = use default
}

// Per-agent override: only specified fields override the global config
export type AgentOverride = Partial<Record<SoundEvent, Partial<EventNotificationConfig>>>

export interface NotificationSettings {
  // Master toggles
  soundEnabled: boolean
  browserNotificationEnabled: boolean

  // Per-event config (global defaults)
  events: Record<SoundEvent, EventNotificationConfig>

  // Per-agent overrides (only non-null fields override the global event config)
  agentOverrides: Partial<Record<AgentType, AgentOverride>>
}

export const SOUND_EVENTS: { key: SoundEvent; label: string; description: string }[] = [
  { key: 'complete', label: 'Task Complete', description: 'When an agent finishes its work' },
  { key: 'waiting_for_user', label: 'Waiting for Input', description: 'When the agent needs your input' },
  { key: 'phase_done', label: 'Phase Done', description: 'When a build phase completes successfully' },
  { key: 'phase_blocked', label: 'Phase Blocked', description: 'When a build phase is blocked and needs intervention' },
  { key: 'new_message', label: 'New Message', description: 'When a new assistant message starts arriving' },
]

export const AGENT_TYPES: { key: AgentType; label: string }[] = [
  { key: 'planner', label: 'Planner' },
  { key: 'build', label: 'Builder' },
  { key: 'sub-agent', label: 'Sub-agent' },
]

// All available sounds shipped with the app
export const AVAILABLE_SOUNDS: { url: string; label: string }[] = [
  { url: '/sounds/notification.mp3', label: 'Notification' },
  { url: '/sounds/waiting-for-user.mp3', label: 'Waiting for User' },
  { url: '/sounds/achievement.mp3', label: 'Achievement' },
  { url: '/sounds/intervention.mp3', label: 'Intervention' },
  { url: '/sounds/typing.mp3', label: 'Typing' },
]

// Default sound paths (shipped with the app)
export const DEFAULT_SOUNDS: Record<SoundEvent, string> = {
  complete: '/sounds/notification.mp3',
  waiting_for_user: '/sounds/waiting-for-user.mp3',
  phase_done: '/sounds/achievement.mp3',
  phase_blocked: '/sounds/intervention.mp3',
  new_message: '/sounds/typing.mp3',
}

const DEFAULT_EVENT_CONFIG: EventNotificationConfig = {
  soundEnabled: true,
  browserNotification: false,
  customSoundUrl: null,
}

const DEFAULT_NEW_MESSAGE_CONFIG: EventNotificationConfig = {
  soundEnabled: false,
  browserNotification: false,
  customSoundUrl: null,
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  soundEnabled: true,
  browserNotificationEnabled: false,
  events: {
    complete: { ...DEFAULT_EVENT_CONFIG },
    waiting_for_user: { ...DEFAULT_EVENT_CONFIG },
    phase_done: { ...DEFAULT_EVENT_CONFIG },
    phase_blocked: { ...DEFAULT_EVENT_CONFIG },
    new_message: { ...DEFAULT_NEW_MESSAGE_CONFIG },
  },
  agentOverrides: {},
}

// Resolve effective config for a given event + agent
export function resolveEventConfig(
  settings: NotificationSettings,
  event: SoundEvent,
  agent?: AgentType,
): EventNotificationConfig {
  const base = settings.events[event]
  if (!agent) return base
  const override = settings.agentOverrides[agent]?.[event]
  if (!override) return base
  return {
    soundEnabled: override.soundEnabled ?? base.soundEnabled,
    browserNotification: override.browserNotification ?? base.browserNotification,
    customSoundUrl: override.customSoundUrl !== undefined ? override.customSoundUrl : base.customSoundUrl,
  }
}

interface NotificationSettingsState {
  settings: NotificationSettings
  loaded: boolean

  load: () => void
  update: (settings: NotificationSettings) => void
  // Convenience: update a single event's config
  updateEvent: (event: SoundEvent, config: Partial<EventNotificationConfig>) => void
  // Convenience: update an agent override
  updateAgentOverride: (agent: AgentType, event: SoundEvent, config: Partial<EventNotificationConfig> | null) => void
}

export const useNotificationSettingsStore = create<NotificationSettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: () => {
    // Subscribe to settings store for server-persisted notification settings
    const settingsStore = useSettingsStore.getState()
    settingsStore.getSetting(SETTINGS_KEYS.NOTIFICATION_SETTINGS)

    // Watch for when the value arrives from server
    const unsubscribe = useSettingsStore.subscribe((state) => {
      const raw = state.settings[SETTINGS_KEYS.NOTIFICATION_SETTINGS]
      if (raw !== undefined) {
        try {
          const parsed = JSON.parse(raw) as Partial<NotificationSettings>
          set({
            settings: mergeWithDefaults(parsed),
            loaded: true,
          })
        } catch {
          set({ loaded: true })
        }
      }
    })

    // Check if already available
    const current = useSettingsStore.getState().settings[SETTINGS_KEYS.NOTIFICATION_SETTINGS]
    if (current) {
      try {
        const parsed = JSON.parse(current) as Partial<NotificationSettings>
        set({
          settings: mergeWithDefaults(parsed),
          loaded: true,
        })
      } catch {
        set({ loaded: true })
      }
    }

    return unsubscribe
  },

  update: (settings) => {
    set({ settings })
    persist(settings)
  },

  updateEvent: (event, config) => {
    const current = get().settings
    const updated: NotificationSettings = {
      ...current,
      events: {
        ...current.events,
        [event]: { ...current.events[event], ...config },
      },
    }
    set({ settings: updated })
    persist(updated)
  },

  updateAgentOverride: (agent, event, config) => {
    const current = get().settings
    const agentOverrides = { ...current.agentOverrides }
    if (config === null) {
      // Remove override
      if (agentOverrides[agent]) {
        const agentConfig = { ...agentOverrides[agent] }
        delete agentConfig[event]
        if (Object.keys(agentConfig).length === 0) {
          delete agentOverrides[agent]
        } else {
          agentOverrides[agent] = agentConfig
        }
      }
    } else {
      agentOverrides[agent] = {
        ...agentOverrides[agent],
        [event]: { ...(agentOverrides[agent]?.[event] ?? {}), ...config },
      }
    }
    const updated: NotificationSettings = { ...current, agentOverrides }
    set({ settings: updated })
    persist(updated)
  },
}))

function persist(settings: NotificationSettings) {
  useSettingsStore.getState().setSetting(SETTINGS_KEYS.NOTIFICATION_SETTINGS, JSON.stringify(settings))
}

function mergeWithDefaults(partial: Partial<NotificationSettings>): NotificationSettings {
  return {
    soundEnabled: partial.soundEnabled ?? DEFAULT_SETTINGS.soundEnabled,
    browserNotificationEnabled: partial.browserNotificationEnabled ?? DEFAULT_SETTINGS.browserNotificationEnabled,
    events: {
      complete: { ...DEFAULT_EVENT_CONFIG, ...partial.events?.complete },
      waiting_for_user: { ...DEFAULT_EVENT_CONFIG, ...partial.events?.waiting_for_user },
      phase_done: { ...DEFAULT_EVENT_CONFIG, ...partial.events?.phase_done },
      phase_blocked: { ...DEFAULT_EVENT_CONFIG, ...partial.events?.phase_blocked },
      new_message: { ...DEFAULT_NEW_MESSAGE_CONFIG, ...partial.events?.new_message },
    },
    agentOverrides: partial.agentOverrides ?? {},
  }
}
