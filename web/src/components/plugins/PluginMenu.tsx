import { DropdownMenu, type DropdownMenuItem } from '../shared/DropdownMenu'
import { usePlugins } from '../../hooks/usePlugins'
import { useLocalizedString } from '../../hooks/useLocalizedString'
import { useT } from '../../hooks/useT'
import { activatePluginAction, isContributionVisible, pluginIcon, type PluginActionContext } from './plugin-ui-utils'
import { GearIcon, PuzzleIcon } from '../shared/icons'

interface PluginMenuProps {
  context: PluginActionContext
  onManage: () => void
}

export function usePluginMenuItems(
  context: PluginActionContext,
  onManage: () => void,
): { items: DropdownMenuItem[]; footerItems: DropdownMenuItem[] } {
  const t = useT()
  const localize = useLocalizedString()
  const { plugins, contributions } = usePlugins()
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled)
  const enabledIds = new Set(enabledPlugins.map((plugin) => plugin.id))
  const headerActions = contributions.actions.filter(
    (action) =>
      (action.slot === 'header.actions' || action.slot === 'session.header.actions') &&
      (action.pluginId ? enabledIds.has(action.pluginId) : false) &&
      isContributionVisible(action.visibleWhen, context),
  )

  const items: DropdownMenuItem[] = [
    {
      label: (
        <span className="cursor-default text-xs font-semibold text-text-muted uppercase tracking-wide">
          {t({ en: 'Plugins', fr: 'Plugins' })}
        </span>
      ),
    },
  ]

  for (const plugin of enabledPlugins) {
    items.push({
      label: (
        <span className="cursor-default text-xs font-semibold text-text-muted uppercase tracking-wide">
          {plugin.displayName}
        </span>
      ),
    })
    for (const action of headerActions.filter((a) => a.pluginId === plugin.id)) {
      const Icon = pluginIcon(action.icon)
      items.push({
        label: localize(action.label),
        icon: <Icon className="w-4 h-4" />,
        onClick: () => void activatePluginAction(action.pluginId, action.onActivate, context),
      })
    }
  }

  if (enabledPlugins.length === 0) {
    items.push({
      label: (
        <span className="cursor-default text-sm text-text-muted">
          {t({ en: 'No plugins installed', fr: 'Aucun plugin installé' })}
        </span>
      ),
    })
  }

  const footerItems: DropdownMenuItem[] = [
    {
      label: t({ en: 'Manage plugins', fr: 'Gérer les plugins' }),
      icon: <GearIcon className="w-4 h-4" />,
      onClick: onManage,
    },
  ]

  return { items, footerItems }
}

export function PluginMenu({ context, onManage }: PluginMenuProps) {
  const t = useT()
  const { items, footerItems } = usePluginMenuItems(context, onManage)

  return (
    <DropdownMenu
      align="right"
      minWidth="240px"
      items={items}
      footerItems={footerItems}
      trigger={
        <button
          type="button"
          className="p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
          title={t({ en: 'Plugins', fr: 'Plugins' })}
          aria-label={t({ en: 'Plugins', fr: 'Plugins' })}
        >
          <PuzzleIcon className="w-4 h-4" />
        </button>
      }
    />
  )
}
