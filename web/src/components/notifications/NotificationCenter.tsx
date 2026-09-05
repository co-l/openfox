import { useEffect, useState } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { ConfirmModal } from '../shared/ConfirmModal'
import { Button } from '../shared/Button'
import { TrashIcon, BellIcon } from '../shared/icons'
import { useNotifications } from '../../hooks/useNotifications'
import { useT } from '../../hooks/useT'
import { getLocale } from '@shared/i18n/index.js'

interface NotificationCenterProps {
  isOpen: boolean
  onClose: () => void
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(getLocale())
}

export function NotificationCenter({ isOpen, onClose }: NotificationCenterProps) {
  const t = useT()
  const { notifications, deleteNotification, clearAll, markAllRead } = useNotifications()
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    if (isOpen) {
      // Opening the center marks everything as read (badge resets).
      void markAllRead()
    }
  }, [isOpen, markAllRead])

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t({ en: 'Notifications', fr: 'Notifications' })}
        size="md"
        showCloseButton
        closeOnBackdropClick
        scrollable={false}
        headerRight={
          notifications.length > 0 ? (
            <Button size="sm" onClick={() => setConfirmClear(true)}>
              {t({ en: 'Clear all', fr: 'Tout effacer' })}
            </Button>
          ) : undefined
        }
      >
        <div className="flex-1 min-h-0 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-2">
              <BellIcon className="w-8 h-8" />
              <span className="text-sm">{t({ en: 'No notifications', fr: 'Aucune notification' })}</span>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => (
                <li key={n.id} className="px-4 py-3 flex items-start gap-3 hover:bg-bg-secondary/50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">{n.title}</span>
                      {n.source && (
                        <span className="text-[10px] uppercase font-medium text-text-muted bg-bg-tertiary rounded px-1.5 py-0.5">
                          {n.source}
                        </span>
                      )}
                    </div>
                    {n.body && (
                      <p className="text-xs text-text-secondary mt-0.5 whitespace-pre-wrap break-words">{n.body}</p>
                    )}
                    <span className="text-[10px] text-text-muted mt-1 inline-block">{formatDate(n.createdAt)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteNotification(n.id)}
                    className="shrink-0 p-1.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-accent-error transition-colors"
                    title={t({ en: 'Dismiss notification', fr: 'Ignorer la notification' })}
                    aria-label={t({ en: 'Dismiss notification', fr: 'Ignorer la notification' })}
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      {confirmClear && (
        <ConfirmModal
          isOpen
          onClose={() => setConfirmClear(false)}
          onConfirm={() => {
            void clearAll()
            setConfirmClear(false)
          }}
          title={t({ en: 'Clear all notifications?', fr: 'Effacer toutes les notifications ?' })}
          message={t({
            en: 'Your entire notification history will be deleted.',
            fr: 'Tout votre historique de notifications sera supprimé.',
          })}
          confirmLabel={t({ en: 'Clear all', fr: 'Tout effacer' })}
          confirmVariant="danger"
        />
      )}
    </>
  )
}
