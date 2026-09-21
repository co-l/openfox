import { useT } from '../../hooks/useT'
import { useNotifications } from '../../hooks/useNotifications'
import { BellIcon } from '../shared/icons'
import { NotificationCenter } from './NotificationCenter'

export function NotificationBell() {
  const t = useT()
  const { unreadCount } = useNotifications()
  const label = t({ en: 'Notifications', fr: 'Notifications' })

  return (
    <NotificationCenter
      trigger={
        <button
          type="button"
          title={label}
          aria-label={label}
          className="relative p-2.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          <BellIcon className="w-4 h-4" />
          {unreadCount > 0 ? (
            <span className="absolute top-1 right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-accent-success text-white text-[9px] font-semibold flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </button>
      }
    />
  )
}
