import {
  useNotificationSettingsStore,
  resolveEventConfig,
  DEFAULT_SOUNDS,
  type SoundEvent,
  type AgentType,
} from '../stores/notifications'

// Audio cache: keyed by URL so custom sounds are also cached
const audioCache = new Map<string, HTMLAudioElement>()

function getAudio(url: string): HTMLAudioElement {
  let audio = audioCache.get(url)
  if (!audio) {
    audio = new Audio(url)
    audio.volume = 0.5
    audioCache.set(url, audio)
  }
  return audio
}

// Browser notification permission state
let notificationPermission: NotificationPermission = typeof Notification !== 'undefined'
  ? Notification.permission
  : 'denied'

export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return Promise.resolve('denied')
  return Notification.requestPermission().then(perm => {
    notificationPermission = perm
    return perm
  })
}

const NOTIFICATION_TITLES: Record<SoundEvent, string> = {
  complete: 'Task Complete',
  waiting_for_user: 'Waiting for Input',
  phase_done: 'Phase Complete',
  phase_blocked: 'Phase Blocked',
}

const NOTIFICATION_BODIES: Record<SoundEvent, string> = {
  complete: 'The agent has finished its work.',
  waiting_for_user: 'The agent needs your input to continue.',
  phase_done: 'The build phase completed successfully.',
  phase_blocked: 'The build phase is blocked and needs intervention.',
}

function sendBrowserNotification(event: SoundEvent) {
  if (typeof Notification === 'undefined') return
  if (notificationPermission !== 'granted') return
  if (document.hasFocus()) return // Don't notify if the window is focused

  new Notification(NOTIFICATION_TITLES[event], {
    body: NOTIFICATION_BODIES[event],
    icon: '/fox.svg',
    tag: `openfox-${event}`, // Prevents duplicate notifications
  })
}

function playEvent(event: SoundEvent, agent?: AgentType) {
  const { settings } = useNotificationSettingsStore.getState()

  // Master sound toggle
  const eventConfig = resolveEventConfig(settings, event, agent)

  // Play sound if enabled
  if (settings.soundEnabled && eventConfig.soundEnabled) {
    const soundUrl = eventConfig.customSoundUrl ?? DEFAULT_SOUNDS[event]
    const audio = getAudio(soundUrl)
    audio.currentTime = 0
    audio.play().catch(() => {}) // Ignore autoplay errors
  }

  // Browser notification if enabled
  if (settings.browserNotificationEnabled && eventConfig.browserNotification) {
    sendBrowserNotification(event)
  }
}

// Public API — same function names for backward compat, but now accept optional agent
export const playNotification = (agent?: AgentType) => playEvent('complete', agent)
export const playAchievement = (agent?: AgentType) => playEvent('phase_done', agent)
export const playIntervention = (agent?: AgentType) => playEvent('phase_blocked', agent)
export const playWaitingForUser = (agent?: AgentType) => playEvent('waiting_for_user', agent)
