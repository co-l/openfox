import { useState, useEffect } from 'react'
import { CheckIcon } from './shared/icons/CheckIcon'
import { XCloseSmallIcon } from './shared/icons/XCloseIcon'
import { useT } from '../hooks/useT'

const STORAGE_KEY = 'openfox_updated_to'
const PENDING_KEY = 'update_pending'

export function UpdateBanner() {
  const t = useT()
  const [dismissed, setDismissed] = useState(false)

  const version = localStorage.getItem(STORAGE_KEY)
  const pending = localStorage.getItem(PENDING_KEY)

  useEffect(() => {
    if (!version || !pending) return
    const timer = setTimeout(() => {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(PENDING_KEY)
      setDismissed(true)
    }, 8_000)
    return () => clearTimeout(timer)
  }, [version, pending])

  const handleDismiss = () => {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(PENDING_KEY)
    setDismissed(true)
  }

  if (dismissed || pending !== 'true' || !version) return null

  return (
    <div
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-2.5 bg-bg-secondary border border-border rounded-lg shadow-xl animate-slide-down"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-accent-primary/20">
        <CheckIcon className="w-3 h-3 text-accent-primary" />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-medium text-text-primary">
          {t({ en: 'OpenFox updated successfully', fr: 'OpenFox mis à jour avec succès' })}
        </span>
        <span className="text-xs text-text-muted">
          {t({ en: 'Now running {{version}}', fr: 'Version {{version}} active' }, { version })}
        </span>
      </div>
      <button
        onClick={handleDismiss}
        className="ml-2 p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
        aria-label={t({ en: 'Dismiss', fr: 'Fermer' })}
      >
        <XCloseSmallIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
