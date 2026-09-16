import { useNotificationToastsStore } from '../../stores/notificationToasts'
import { BellIcon, XCloseIcon } from '../shared/icons'
import { useT } from '../../hooks/useT'

export function NotificationToasts() {
  const t = useT()
  const toasts = useNotificationToastsStore((state) => state.toasts)
  const dismissToast = useNotificationToastsStore((state) => state.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-10 right-3 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-24px)]">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-start gap-3 px-4 py-3 rounded-lg bg-bg-secondary border border-border shadow-xl text-sm text-text-primary"
        >
          <div className="shrink-0 mt-0.5 text-accent-primary">
            <BellIcon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{toast.title}</div>
            {toast.body && (
              <div className="text-xs text-text-secondary whitespace-pre-wrap break-words">{toast.body}</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="shrink-0 p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title={t({ en: 'Dismiss', fr: 'Fermer' })}
            aria-label={t({ en: 'Dismiss notification', fr: 'Ignorer la notification' })}
          >
            <XCloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
