import type { ReactNode } from 'react'
import { useT } from '../../hooks/useT'
import { useLocalizedString } from '../../hooks/useLocalizedString'
import { useNotifications } from '../../hooks/useNotifications'
import { NotificationActions } from './NotificationActions'
import { DropdownMenu, type DropdownMenuItem } from '../shared/DropdownMenu'
import { TrashIcon } from '../shared/icons'
import { formatDateTime } from '../../lib/format-date'

export function useNotificationMenuItems(): {
  items: DropdownMenuItem[]
  footerItems: DropdownMenuItem[]
  unreadCount: number
} {
  const t = useT()
  const localize = useLocalizedString()
  const { notifications, unreadCount, markAllRead, markRead, remove, clear } = useNotifications()

  const items: DropdownMenuItem[] = [
    {
      label: (
        <span className="cursor-default text-xs font-semibold text-text-muted uppercase tracking-wide">
          {t({ en: 'Notifications', fr: 'Notifications' })}
          {unreadCount > 0 ? ` (${unreadCount})` : ''}
        </span>
      ),
    },
  ]

  if (notifications.length === 0) {
    items.push({
      label: (
        <span className="cursor-default text-sm text-text-muted">
          {t({ en: 'No notifications yet', fr: 'Aucune notification pour le moment' })}
        </span>
      ),
    })
  } else {
    for (const notification of notifications) {
      items.push({
        label: (
          <div className="min-w-0 flex items-start gap-2">
            {!notification.readAt ? (
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent-primary flex-shrink-0" />
            ) : null}
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary">{localize(notification.title)}</p>
              {notification.body ? (
                <p className="mt-0.5 text-xs text-text-secondary">{localize(notification.body)}</p>
              ) : null}
              {(notification.actions ?? []).length > 0 ? (
                <NotificationActions pluginId={notification.pluginId} actions={notification.actions ?? []} />
              ) : null}
              <p className="mt-1 text-[10px] text-text-muted">
                {notification.pluginId} · {formatDateTime(notification.createdAt)}
              </p>
            </div>
          </div>
        ),
        labelAction: (
          <button
            type="button"
            aria-label={t({ en: 'Delete notification', fr: 'Supprimer la notification' })}
            onClick={() => void remove(notification.id)}
            className="text-text-muted hover:text-accent-error shrink-0"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        ),
        onClick: () => void markRead(notification.id),
        closeOnClick: false,
      })
    }
  }

  const footerItems: DropdownMenuItem[] =
    notifications.length > 0
      ? [
          {
            label: t({ en: 'Mark all as read', fr: 'Tout marquer comme lu' }),
            onClick: () => void markAllRead(),
          },
          {
            label: t({ en: 'Clear all', fr: 'Tout effacer' }),
            onClick: () => void clear(),
          },
        ]
      : []

  return { items, footerItems, unreadCount }
}

export function NotificationCenter({ trigger }: { trigger: ReactNode }) {
  const { items, footerItems } = useNotificationMenuItems()
  return <DropdownMenu align="right" minWidth="340px" items={items} footerItems={footerItems} trigger={trigger} />
}
