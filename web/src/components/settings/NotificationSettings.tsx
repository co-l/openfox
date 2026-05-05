import { useEffect } from 'react'
import {
  useNotificationSettingsStore,
  SOUND_EVENTS,
  AVAILABLE_SOUNDS,
  DEFAULT_SOUNDS,
  resolveEventConfig,
  type SoundEvent,
} from '../../stores/notifications'
import { requestNotificationPermission } from '../../lib/sound'
import { ChevronDownIcon } from '../shared/icons'

function SoundPicker({
  value,
  defaultUrl,
  disabled,
  onChange,
}: {
  value: string | null
  defaultUrl: string
  disabled?: boolean
  onChange: (url: string | null) => void
}) {
  const effectiveUrl = value ?? defaultUrl
  return (
    <div className="relative">
      <select
        value={effectiveUrl}
        disabled={disabled}
        onChange={(e) => {
          const url = e.target.value
          onChange(url === defaultUrl ? null : url)
        }}
        className="appearance-none bg-bg-tertiary border border-border rounded px-1.5 pr-5 text-xs focus:outline-none focus:ring-1 focus:ring-accent-primary disabled:opacity-40 cursor-pointer"
        style={{ width: '60px' }}
      >
        {AVAILABLE_SOUNDS.map(({ url, label }) => (
          <option key={url} value={url} title={label}>
            {label.split(' ')[0]}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="absolute right-0.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none text-text-muted" />
    </div>
  )
}

const AGENT_COLUMNS = [
  { key: 'general', label: 'General' },
  { key: 'build', label: 'Agent' },
  { key: 'sub-agent', label: 'Sub-agent' },
] as const

type ColumnKey = (typeof AGENT_COLUMNS)[number]['key']

export function NotificationSettings() {
  const settings = useNotificationSettingsStore((s) => s.settings)
  const update = useNotificationSettingsStore((s) => s.update)
  const updateEvent = useNotificationSettingsStore((s) => s.updateEvent)
  const updateAgentOverride = useNotificationSettingsStore((s) => s.updateAgentOverride)
  const load = useNotificationSettingsStore((s) => s.load)

  useEffect(() => {
    load()
  }, [load])

  const handleRequestPermission = async () => {
    const perm = await requestNotificationPermission()
    if (perm === 'granted') {
      update({ ...settings, browserNotificationEnabled: true })
    }
  }

  const handleToggle = (
    column: ColumnKey,
    event: SoundEvent,
    field: 'soundEnabled' | 'browserNotification',
    value: boolean,
  ) => {
    if (column === 'general') {
      updateEvent(event, { [field]: value })
    } else {
      updateAgentOverride(column, event, { [field]: value })
    }
  }

  const handleSoundChange = (column: ColumnKey, event: SoundEvent, url: string | null) => {
    if (column === 'general') {
      updateEvent(event, { customSoundUrl: url })
    } else {
      updateAgentOverride(column, event, { customSoundUrl: url })
    }
  }

  return (
    <div className="space-y-6">
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
        {typeof Notification !== 'undefined' &&
          Notification.permission === 'denied' &&
          settings.browserNotificationEnabled && (
            <p className="text-xs text-accent-error ml-6">
              Browser notifications are blocked. Please enable them in your browser settings.
            </p>
          )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">Notification Settings</h3>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-tertiary">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 text-text-primary font-medium w-40">Event</th>
                {AGENT_COLUMNS.map((col) => (
                  <th key={col.key} className="text-center px-2 py-2 text-text-primary font-medium">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SOUND_EVENTS.map((event) => (
                <tr key={event.key} className="border-b border-border last:border-b-0 hover:bg-bg-secondary/50">
                  <td className="px-3 py-2">
                    <div className="text-text-primary text-xs">{event.label}</div>
                  </td>
                  {AGENT_COLUMNS.map((col) => {
                    const config = resolveEventConfig(
                      settings,
                      event.key,
                      col.key === 'general' ? undefined : (col.key as 'build' | 'sub-agent'),
                    )
                    const defaultSound = DEFAULT_SOUNDS[event.key]
                    return (
                      <td key={col.key} className="px-2 py-2 align-top">
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-text-secondary">
                              <input
                                type="checkbox"
                                checked={config.soundEnabled}
                                onChange={(e) => handleToggle(col.key, event.key, 'soundEnabled', e.target.checked)}
                                disabled={!settings.soundEnabled}
                                className="rounded border-border"
                                title="Sound"
                              />
                            </label>
                            <label className="flex items-center gap-1 text-text-secondary">
                              <input
                                type="checkbox"
                                checked={config.browserNotification}
                                onChange={(e) =>
                                  handleToggle(col.key, event.key, 'browserNotification', e.target.checked)
                                }
                                disabled={!settings.browserNotificationEnabled}
                                className="rounded border-border"
                                title="Browser"
                              />
                            </label>
                          </div>
                          {config.soundEnabled && settings.soundEnabled && (
                            <SoundPicker
                              value={config.customSoundUrl}
                              defaultUrl={defaultSound}
                              disabled={!settings.soundEnabled}
                              onChange={(url) => handleSoundChange(col.key, event.key, url)}
                            />
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
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
          onClick={(e) => {
            e.preventDefault()
            onChange(!checked)
          }}
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
