import { useLocalizedString } from '../../hooks/useLocalizedString'
import { activatePluginAction } from '../plugins/plugin-ui-utils'
import type { PluginNotificationAction } from '@shared/plugin.js'

/**
 * Action buttons attached to a plugin notification. Rendered identically by the
 * toast and the notification center so both surfaces stay in sync.
 */
export function NotificationActions({ pluginId, actions }: { pluginId: string; actions: PluginNotificationAction[] }) {
  const localize = useLocalizedString()
  if (actions.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {actions.map((action, index) => (
        <button
          key={index}
          type="button"
          onClick={() => void activatePluginAction(pluginId, action.onActivate, {})}
          className="px-2 py-0.5 rounded text-xs bg-bg-tertiary text-text-primary hover:bg-bg-primary transition-colors"
        >
          {localize(action.label)}
        </button>
      ))}
    </div>
  )
}
