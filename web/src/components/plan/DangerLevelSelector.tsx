import { useSessionStore } from '../../stores/session'
import { useT } from '../../hooks/useT'
import { useLocalizedString } from '../../hooks/useLocalizedString'
import { usePlugins } from '../../hooks/usePlugins'
import { useSessionScope, useScopedPaneState } from '../../stores/session/session-scope'
import { useSetting } from '../../hooks/useSetting'
import { SETTINGS_KEYS } from '../../lib/resources'

export function DangerLevelSelector() {
  const t = useT()
  const loc = useLocalizedString()
  const { contributions } = usePlugins()
  const pluginDangerLevels = contributions.dangerLevels ?? []
  const sessionId = useSessionScope()
  const dangerLevel = useScopedPaneState(
    sessionId,
    (pane) => pane.session?.dangerLevel ?? 'normal',
    (state) => state.currentSession?.dangerLevel ?? 'normal',
    'normal',
  )
  const switchDangerLevel = useSessionStore((state) => state.switchDangerLevel)

  const displayModeSetting = useSetting(SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_DISPLAY_MODE, 'default')
  const autoListSetting = useSetting(SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_AUTO_LIST, 'false')
  const autoListThresholdSetting = useSetting(SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_AUTO_LIST_THRESHOLD, '3')

  if (!sessionId) return null

  const totalDangerLevels = 2 + pluginDangerLevels.length
  const threshold = parseInt(autoListThresholdSetting.value || '3', 10) || 3
  const isAutoList = autoListSetting.value === 'true' && totalDangerLevels > threshold
  const isListMode = displayModeSetting.value === 'list' || isAutoList

  if (isListMode) {
    return (
      <div className="flex items-center px-1.5 py-0.5 rounded bg-bg-tertiary/50">
        <select
          value={dangerLevel}
          onChange={(e) => switchDangerLevel(sessionId, e.target.value)}
          className="text-xs bg-transparent border-none text-text-primary focus:outline-none cursor-pointer pr-1 py-0.5 font-medium"
        >
          <option value="normal" className="bg-bg-primary text-text-primary">
            {t({ en: 'Normal', fr: 'Normal' })}
          </option>
          {pluginDangerLevels.map((dl) => (
            <option key={dl.id} value={dl.id} className="bg-bg-primary text-text-primary">
              {loc(dl.label)}
            </option>
          ))}
          <option value="dangerous" className="bg-bg-primary text-text-primary">
            {t({ en: 'Dangerous', fr: 'Dangereux' })}
          </option>
        </select>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-tertiary/50">
      <button
        type="button"
        onClick={() => switchDangerLevel(sessionId, 'normal')}
        className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
          dangerLevel === 'normal'
            ? 'bg-accent-success/20 text-accent-success'
            : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
        }`}
        title={t({
          en: 'Normal mode - requires path confirmation',
          fr: 'Mode normal - confirmation des chemins requise',
        })}
      >
        {t({ en: 'Normal', fr: 'Normal' })}
      </button>
      {pluginDangerLevels.map((dl) => (
        <button
          key={dl.id}
          type="button"
          onClick={() => switchDangerLevel(sessionId, dl.id)}
          className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
            dangerLevel === dl.id
              ? 'bg-accent-primary/20 text-accent-primary'
              : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
          }`}
          title={dl.description ? loc(dl.description) : undefined}
        >
          {loc(dl.label)}
        </button>
      ))}
      <button
        type="button"
        onClick={() => switchDangerLevel(sessionId, 'dangerous')}
        className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
          dangerLevel === 'dangerous'
            ? 'bg-red-500/20 text-red-400'
            : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
        }`}
        title={t({
          en: 'Dangerous mode - bypasses all confirmations',
          fr: 'Mode dangereux - contourne toutes les confirmations',
        })}
      >
        {t({ en: 'Dangerous', fr: 'Dangereux' })}
      </button>
    </div>
  )
}
