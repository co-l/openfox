import { useEffect } from 'react'
import { useT } from '../../hooks/useT'
import { useLocalizedString } from '../../hooks/useLocalizedString'
import { usePluginToastStore } from '../../stores/pluginToasts'
import { NotificationActions } from './NotificationActions'
import { XCloseSmallIcon } from '../shared/icons'
import type { PluginNotificationLevel } from '@shared/plugin.js'

const LEVEL_CLASSES: Record<PluginNotificationLevel, string> = {
  info: 'border-accent-primary/40',
  success: 'border-accent-success/40',
  warning: 'border-accent-warning/40',
  error: 'border-accent-error/40',
}

export function NotificationToasts() {
  const t = useT()
  const localize = useLocalizedString()
  const toasts = usePluginToastStore((state) => state.toasts)
  const dismiss = usePluginToastStore((state) => state.dismiss)

  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map((toast) =>
      setTimeout(() => dismiss(toast.notification.id), Math.max(0, toast.expiresAt - Date.now())),
    )
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [toasts, dismiss])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-14 right-4 z-50 flex flex-col gap-2 w-80" role="status" aria-live="polite">
      {toasts.map(({ notification }) => (
        <div
          key={notification.id}
          className={`bg-bg-secondary border rounded-lg shadow-lg p-3 ${LEVEL_CLASSES[notification.level]}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-text-primary">{localize(notification.title)}</p>
              {notification.body ? (
                <p className="mt-1 text-xs text-text-secondary">{localize(notification.body)}</p>
              ) : null}
              {(notification.actions ?? []).length > 0 ? (
                <NotificationActions pluginId={notification.pluginId} actions={notification.actions ?? []} />
              ) : null}
            </div>
            <button
              type="button"
              aria-label={t({ en: 'Dismiss notification', fr: 'Fermer la notification' })}
              onClick={() => dismiss(notification.id)}
              className="text-text-muted hover:text-text-primary"
            >
              <XCloseSmallIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
