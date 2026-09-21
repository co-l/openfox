import { formatDateTime } from '../lib/format-date'
import { BranchIcon, CopyIcon } from '../components/shared/icons'
import { useT } from './useT'
import { usePlugins } from './usePlugins'
import { useLocalizedString } from './useLocalizedString'
import { activatePluginAction, pluginIcon } from '../components/plugins/plugin-ui-utils'
import type { Message } from '@shared/types.js'
import type { ContextMenuItem } from '../components/shared/ContextMenu'

export function useMessageContextMenu(message: Message, onCopy: () => void, onFork: () => void): ContextMenuItem[] {
  const t = useT()
  const localize = useLocalizedString()
  const { contributions } = usePlugins()
  const pluginItems: ContextMenuItem[] = contributions.actions
    .filter((action) => action.slot === 'message.actions')
    .map((action) => {
      const Icon = pluginIcon(action.icon)
      return {
        label: localize(action.label),
        icon: <Icon className="w-4 h-4" />,
        onClick: () => void activatePluginAction(action.pluginId, action.onActivate, { messageId: message.id }),
      }
    })
  return [
    {
      label: formatDateTime(message.timestamp),
      info: true,
    },
    {
      label: t({ en: 'Copy', fr: 'Copier' }),
      icon: <CopyIcon className="w-4 h-4" />,
      onClick: () => void onCopy(),
    },
    {
      label: t({ en: 'Fork session from here', fr: 'Dupliquer la session à partir d’ici' }),
      icon: <BranchIcon className="w-4 h-4" />,
      onClick: () => void onFork(),
    },
    ...pluginItems,
  ]
}
