import { useEffect } from 'react'
import {
  useNotificationSettingsStore,
  SOUND_EVENTS,
  AVAILABLE_SOUNDS,
  DEFAULT_SOUNDS,
  resolveEventConfig,
  type SoundEvent,
  type PluginUpdateInterval,
} from '../../stores/notifications'
import { requestNotificationPermission } from '../../lib/sound'
import { ChevronDownIcon } from '../shared/icons'
import { Toggle } from '../shared/Toggle'
import { useT } from '../../hooks/useT'

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

const AGENT_COLUMNS = [{ key: 'general' }, { key: 'build' }, { key: 'sub-agent' }] as const

type ColumnKey = (typeof AGENT_COLUMNS)[number]['key']

export function NotificationSettings() {
  const t = useT()
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

  const columnLabels: Record<ColumnKey, string> = {
    general: t({ en: 'General', fr: 'Général' }),
    build: t({ en: 'Agent', fr: 'Agent' }),
    'sub-agent': t({ en: 'Sub-agent', fr: 'Sous-agent' }),
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">
          {t({ en: 'Master Controls', fr: 'Contrôles principaux' })}
        </h3>
        <NotificationToggle
          label={t({ en: 'Sound notifications', fr: 'Notifications sonores' })}
          description={t({
            en: 'Play sounds when events occur',
            fr: 'Jouer des sons lorsque des événements se produisent',
          })}
          checked={settings.soundEnabled}
          onChange={(v) => update({ ...settings, soundEnabled: v })}
        />
        <NotificationToggle
          label={t({ en: 'Browser notifications', fr: 'Notifications du navigateur' })}
          description={t({
            en: 'Show desktop notifications when the window is not focused',
            fr: 'Afficher des notifications de bureau lorsque la fenêtre n’est pas ciblée',
          })}
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
              {t({
                en: 'Browser notifications are blocked. Please enable them in your browser settings.',
                fr: 'Les notifications du navigateur sont bloquées. Veuillez les activer dans les paramètres de votre navigateur.',
              })}
            </p>
          )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">
          {t({ en: 'Plugin Notifications', fr: 'Notifications des plugins' })}
        </h3>
        <NotificationToggle
          label={t({ en: 'Plugin update notifications', fr: 'Notifications de mise à jour des plugins' })}
          description={t({
            en: 'Notify when an update is available for an installed plugin',
            fr: 'Notifier lorsqu’une mise à jour est disponible pour un plugin installé',
          })}
          checked={settings.pluginUpdateNotificationEnabled}
          onChange={(v) => update({ ...settings, pluginUpdateNotificationEnabled: v })}
        />
        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary">
              {t({ en: 'Check for plugin updates', fr: 'Vérification des mises à jour' })}
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              {t({
                en: 'Frequency to check for new plugin versions',
                fr: 'Fréquence de vérification des nouvelles versions de plugins',
              })}
            </div>
          </div>
          <div className="relative flex-shrink-0">
            <select
              value={settings.pluginUpdateCheckInterval}
              disabled={!settings.pluginUpdateNotificationEnabled}
              aria-label={t({ en: 'Check for plugin updates', fr: 'Vérification des mises à jour' })}
              onChange={(e) =>
                update({
                  ...settings,
                  pluginUpdateCheckInterval: e.target.value as PluginUpdateInterval,
                })
              }
              className="appearance-none bg-bg-tertiary border border-border rounded px-2.5 py-1 pr-7 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary disabled:opacity-40 cursor-pointer"
            >
              <option value="1h">{t({ en: 'Every hour', fr: 'Toutes les heures' })}</option>
              <option value="6h">{t({ en: 'Every 6 hours', fr: 'Toutes les 6 heures' })}</option>
              <option value="24h">{t({ en: 'Every 24 hours', fr: 'Toutes les 24h' })}</option>
              <option value="startup">{t({ en: 'On OpenFox startup', fr: 'Au lancement d’OpenFox' })}</option>
            </select>
            <ChevronDownIcon className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none text-text-muted" />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">
          {t({ en: 'Notification Settings', fr: 'Paramètres de notification' })}
        </h3>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-tertiary">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 text-text-primary font-medium w-40">
                  {t({ en: 'Event', fr: 'Événement' })}
                </th>
                {AGENT_COLUMNS.map((col) => (
                  <th key={col.key} className="text-center px-2 py-2 text-text-primary font-medium">
                    {columnLabels[col.key]}
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
                                title={t({ en: 'Sound', fr: 'Son' })}
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
                                title={t({ en: 'Browser', fr: 'Navigateur' })}
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

function NotificationToggle({
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
    <label className="flex items-start justify-between gap-3 cursor-pointer group">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary group-hover:text-accent-primary transition-colors">{label}</div>
        <div className="text-xs text-text-muted mt-0.5">{description}</div>
      </div>
      <div className="flex-shrink-0 pt-0.5">
        <Toggle enabled={checked} onClick={() => onChange(!checked)} label={label} />
      </div>
    </label>
  )
}
