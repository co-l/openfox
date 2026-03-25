import { useEffect, useState } from 'react'
import {
  useNotificationSettingsStore,
  SOUND_EVENTS,
  AGENT_TYPES,
  DEFAULT_SOUNDS,
  resolveEventConfig,
  type SoundEvent,
  type AgentType,
  type EventNotificationConfig,
} from '../../stores/notifications'
import { requestNotificationPermission } from '../../lib/sound'

export function NotificationSettings() {
  const settings = useNotificationSettingsStore(s => s.settings)
  const update = useNotificationSettingsStore(s => s.update)
  const updateEvent = useNotificationSettingsStore(s => s.updateEvent)
  const updateAgentOverride = useNotificationSettingsStore(s => s.updateAgentOverride)
  const load = useNotificationSettingsStore(s => s.load)

  const [expandedAgent, setExpandedAgent] = useState<AgentType | null>(null)

  useEffect(() => {
    load()
  }, [load])

  const handleRequestPermission = async () => {
    const perm = await requestNotificationPermission()
    if (perm === 'granted') {
      update({ ...settings, browserNotificationEnabled: true })
    }
  }

  const handleTestSound = (event: SoundEvent) => {
    const config = resolveEventConfig(settings, event)
    const url = config.customSoundUrl ?? DEFAULT_SOUNDS[event]
    const audio = new Audio(url)
    audio.volume = 0.5
    audio.play().catch(() => {})
  }

  return (
    <div className="space-y-6">
      {/* Master toggles */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">Master Controls</h3>
        <Toggle
          label="Sound notifications"
          description="Play sounds when events occur"
          checked={settings.soundEnabled}
          onChange={(v) => update({ ...settings, soundEnabled: v })}
        />
        <Toggle
          label="Browser notifications"
          description="Show desktop notifications when the window is not focused"
          checked={settings.browserNotificationEnabled}
          onChange={(v) => {
            if (v && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
              handleRequestPermission()
            } else {
              update({ ...settings, browserNotificationEnabled: v })
            }
          }}
        />
        {typeof Notification !== 'undefined' && Notification.permission === 'denied' && settings.browserNotificationEnabled && (
          <p className="text-xs text-accent-error ml-6">
            Browser notifications are blocked. Please enable them in your browser settings.
          </p>
        )}
      </div>

      {/* Per-event configuration */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">Event Configuration</h3>
        {SOUND_EVENTS.map(({ key, label, description }) => (
          <EventConfig
            key={key}
            event={key}
            label={label}
            description={description}
            config={settings.events[key]}
            onUpdate={(cfg) => updateEvent(key, cfg)}
            onTest={() => handleTestSound(key)}
            soundMasterEnabled={settings.soundEnabled}
            browserMasterEnabled={settings.browserNotificationEnabled}
          />
        ))}
      </div>

      {/* Per-agent overrides */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">Per-Agent Overrides</h3>
        <p className="text-xs text-text-muted">
          Override notification settings for specific agent types. Unconfigured events use the global defaults above.
        </p>
        {AGENT_TYPES.map(({ key, label }) => (
          <div key={key} className="border border-border rounded">
            <button
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-text-secondary hover:bg-bg-tertiary transition-colors rounded"
              onClick={() => setExpandedAgent(expandedAgent === key ? null : key)}
            >
              <span className="font-medium">{label}</span>
              <svg
                className={`w-4 h-4 transition-transform ${expandedAgent === key ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedAgent === key && (
              <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                {SOUND_EVENTS.map(({ key: eventKey, label: eventLabel }) => {
                  const override = settings.agentOverrides[key]?.[eventKey]
                  const hasOverride = override !== undefined
                  const effective = resolveEventConfig(settings, eventKey, key)
                  return (
                    <div key={eventKey} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={hasOverride}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateAgentOverride(key, eventKey, { soundEnabled: effective.soundEnabled })
                          } else {
                            updateAgentOverride(key, eventKey, null)
                          }
                        }}
                        className="rounded border-border"
                      />
                      <span className={`flex-1 ${hasOverride ? 'text-text-primary' : 'text-text-muted'}`}>
                        {eventLabel}
                      </span>
                      {hasOverride && (
                        <>
                          <label className="flex items-center gap-1 text-text-secondary">
                            <input
                              type="checkbox"
                              checked={effective.soundEnabled}
                              onChange={(e) => updateAgentOverride(key, eventKey, { soundEnabled: e.target.checked })}
                              className="rounded border-border"
                            />
                            Sound
                          </label>
                          <label className="flex items-center gap-1 text-text-secondary">
                            <input
                              type="checkbox"
                              checked={effective.browserNotification}
                              onChange={(e) => updateAgentOverride(key, eventKey, { browserNotification: e.target.checked })}
                              className="rounded border-border"
                            />
                            Browser
                          </label>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Sub-components ---

function Toggle({ label, description, checked, onChange }: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="pt-0.5">
        <div
          className={`relative w-9 h-5 rounded-full transition-colors ${
            checked ? 'bg-accent-primary' : 'bg-bg-tertiary border border-border'
          }`}
          onClick={(e) => { e.preventDefault(); onChange(!checked) }}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </div>
      </div>
      <div>
        <div className="text-sm text-text-primary group-hover:text-accent-primary transition-colors">{label}</div>
        <div className="text-xs text-text-muted">{description}</div>
      </div>
    </label>
  )
}

function EventConfig({ event, label, description, config, onUpdate, onTest, soundMasterEnabled, browserMasterEnabled }: {
  event: SoundEvent
  label: string
  description: string
  config: EventNotificationConfig
  onUpdate: (cfg: Partial<EventNotificationConfig>) => void
  onTest: () => void
  soundMasterEnabled: boolean
  browserMasterEnabled: boolean
}) {
  const [showCustomUrl, setShowCustomUrl] = useState(false)

  return (
    <div className="border border-border rounded px-3 py-2 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-text-primary">{label}</div>
          <div className="text-xs text-text-muted">{description}</div>
        </div>
        <button
          onClick={onTest}
          disabled={!soundMasterEnabled || !config.soundEnabled}
          className="text-xs px-2 py-1 rounded border border-border text-text-secondary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Test this sound"
        >
          Test
        </button>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={config.soundEnabled}
            onChange={(e) => onUpdate({ soundEnabled: e.target.checked })}
            disabled={!soundMasterEnabled}
            className="rounded border-border"
          />
          Sound {!soundMasterEnabled && <span className="text-text-muted">(master off)</span>}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={config.browserNotification}
            onChange={(e) => onUpdate({ browserNotification: e.target.checked })}
            disabled={!browserMasterEnabled}
            className="rounded border-border"
          />
          Browser notification {!browserMasterEnabled && <span className="text-text-muted">(master off)</span>}
        </label>
        <button
          onClick={() => setShowCustomUrl(!showCustomUrl)}
          className="text-xs text-accent-primary hover:underline ml-auto"
        >
          {config.customSoundUrl ? 'Custom sound' : 'Custom sound...'}
        </button>
      </div>
      {showCustomUrl && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={config.customSoundUrl ?? ''}
            onChange={(e) => onUpdate({ customSoundUrl: e.target.value || null })}
            placeholder={DEFAULT_SOUNDS[event]}
            className="flex-1 px-2 py-1 text-xs bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent-primary font-mono"
          />
          {config.customSoundUrl && (
            <button
              onClick={() => onUpdate({ customSoundUrl: null })}
              className="text-xs text-accent-error hover:underline"
            >
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}
