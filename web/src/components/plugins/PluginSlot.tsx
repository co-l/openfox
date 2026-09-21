import { usePlugins } from '../../hooks/usePlugins'
import { useLocalizedString } from '../../hooks/useLocalizedString'
import { activatePluginAction, isContributionVisible, pluginIcon, type PluginActionContext } from './plugin-ui-utils'
import type { PluginUiAction } from '@shared/plugin.js'

export type PluginActionSlot = PluginUiAction['slot']

const VARIANT_CLASSES: Record<NonNullable<PluginUiAction['variant']>, string> = {
  default: 'text-text-secondary hover:text-text-primary hover:bg-bg-primary',
  primary: 'text-accent-primary hover:bg-accent-primary/10',
  danger: 'text-accent-error hover:bg-accent-error/10',
  ghost: 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary',
}

export function PluginActionButton({ action, context }: { action: PluginUiAction; context: PluginActionContext }) {
  const localize = useLocalizedString()
  const Icon = pluginIcon(action.icon)
  const label = localize(action.label)
  const tooltip = localize(action.tooltip ?? action.label)
  return (
    <button
      type="button"
      title={tooltip}
      aria-label={label}
      onClick={() => void activatePluginAction(action.pluginId, action.onActivate, context)}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-sm transition-colors ${
        VARIANT_CLASSES[action.variant ?? 'default']
      }`}
    >
      <Icon className="w-4 h-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export function PluginSlot({ slot, context }: { slot: PluginActionSlot; context: PluginActionContext }) {
  const { contributions } = usePlugins()
  const actions = contributions.actions.filter(
    (action) => action.slot === slot && isContributionVisible(action.visibleWhen, context),
  )
  if (actions.length === 0) return null
  return (
    <>
      {actions.map((action) => (
        <PluginActionButton key={`${action.pluginId}:${action.id}`} action={action} context={context} />
      ))}
    </>
  )
}
