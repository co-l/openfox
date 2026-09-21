import { useState, useEffect, useCallback, useRef } from 'react'
import { Modal } from './shared/Modal'
import { authFetch } from '../lib/api'
import { appUrl } from '../lib/basePath'
import { useT } from '../hooks/useT'
import { getStoredLastVersion, stampPreviousVersion } from '../lib/versionTracking'

type ModalState = 'ready' | 'updating' | 'complete' | 'failed' | 'restarting' | 'restartFailed'

interface AutoUpdateModalProps {
  isOpen: boolean
  onClose: () => void
  versionInfo: { current: string; latest: string } | null
}

const POLL_INTERVAL_MS = 1_000
const POLL_TIMEOUT_MS = 30_000

function FallbackPanel({
  message,
  command,
  hint,
}: {
  message: string | null
  command: string
  hint: { en: string; fr: string }
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3 mt-2">
      <div className="flex items-center gap-2 px-3 py-2 bg-accent-danger/10 border border-accent-danger/30 rounded text-xs">
        <span>⚠️</span>
        <p className="text-text-secondary">{message}</p>
      </div>
      <div className="bg-bg-tertiary rounded px-3 py-2 text-xs font-mono text-text-secondary">{command}</div>
      <p className="text-xs text-text-muted">{t(hint)}</p>
    </div>
  )
}

export function AutoUpdateModal({ isOpen, onClose, versionInfo }: AutoUpdateModalProps) {
  const t = useT()
  const [state, setState] = useState<ModalState>('ready')
  const [progressDots, setProgressDots] = useState('')
  const [modalVersionInfo, setModalVersionInfo] = useState(versionInfo)
  const [updatedVersion, setUpdatedVersion] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [restartAvailable, setRestartAvailable] = useState(false)
  const [serviceMode, setServiceMode] = useState(false)
  const [autoRestart, setAutoRestart] = useState(false)
  // Mirrors autoRestart for the update success handler: the decision must be
  // read when the POST resolves (the user may toggle mid-download), not from a
  // stale useCallback closure.
  const autoRestartRef = useRef(false)
  const isDev = import.meta.env.DEV

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollStartedAtRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  // Latest versionInfo prop, readable from the open-time effect without making
  // it a dependency (the prop is recreated on parent renders; refetching on
  // identity change would be wasted /check traffic).
  const versionInfoRef = useRef(versionInfo)
  versionInfoRef.current = versionInfo

  // Fetch /check once per open: learns service-mode (checkbox visibility) and,
  // when no versionInfo was provided, the current/latest versions. /check is
  // public and cached server-side, and service-ness is a stable server property.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(appUrl('/api/auto-update/check'))
        const data = (await res.json()) as { current?: string; latest?: string; isService?: boolean }
        if (cancelled) return
        setServiceMode(Boolean(data.isService))
        if (!versionInfoRef.current && data.current && data.latest) {
          setModalVersionInfo({ current: data.current, latest: data.latest })
        }
      } catch {
        if (!cancelled) setServiceMode(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || (state !== 'updating' && state !== 'restarting')) return
    const dots = setInterval(() => {
      setProgressDots((d) => (d.length >= 3 ? '' : d + '.'))
    }, 400)
    return () => clearInterval(dots)
  }, [isOpen, state])

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    pollStartedAtRef.current = null
  }, [])

  const enterRestartFailed = useCallback((message: string) => {
    setErrorMessage(message)
    setState('restartFailed')
  }, [])

  const toggleAutoRestart = useCallback((checked: boolean) => {
    autoRestartRef.current = checked
    setAutoRestart(checked)
  }, [])

  // Announce a successfully applied update. Deliberately deferred until the
  // new version is confirmed running (right before reload) so the success
  // banner/changelog never fire for a version that is not live yet.
  const markUpdateApplied = useCallback((version: string) => {
    // Pin the pre-update version as the trim boundary. The last observed
    // version is the reliable source; the version reported at modal open is a
    // fallback. Guard against mistaking the freshly installed version for the
    // previous one, since a reloaded window may already report it.
    const previous = getStoredLastVersion() ?? versionInfoRef.current?.current ?? null
    if (previous && previous !== version) stampPreviousVersion(previous)
    localStorage.setItem('openfox_updated_to', version)
    localStorage.setItem('update_pending', 'true')
  }, [])

  // Shared restart + confirmation routine used by both the manual
  // "Restart OpenFox now" button and the auto-restart checkbox path.
  const restartAndPoll = useCallback(
    async (installedVersion: string) => {
      setState('restarting')
      setErrorMessage(null)
      clearPoll()

      // Best-effort trigger: the server may go down before responding.
      try {
        await authFetch('/api/auto-update/restart', { method: 'POST' })
      } catch {
        // Ignore: the server is expected to be unreachable momentarily during restart.
      }

      if (!mountedRef.current) return

      pollStartedAtRef.current = Date.now()

      const tick = async (): Promise<void> => {
        if (!mountedRef.current) {
          clearPoll()
          return
        }

        const startedAt = pollStartedAtRef.current
        if (startedAt !== null && Date.now() - startedAt >= POLL_TIMEOUT_MS) {
          clearPoll()
          enterRestartFailed(
            t({
              en: 'OpenFox could not be reached after restart within 30 seconds. Please restart OpenFox manually.',
              fr: 'OpenFox est resté injoignable pendant 30 secondes après le redémarrage. Veuillez redémarrer OpenFox manuellement.',
            }),
          )
          return
        }

        try {
          // Intentionally raw `fetch` (not `authFetch`): during the restart window
          // the server may be down or the session token may have been invalidated
          // by the reload, so we don't want to fail the poll on auth/transport
          // errors. /api/auto-update/check is in the publicPaths allowlist.
          const res = await fetch(appUrl('/api/auto-update/check?force=true'))
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = (await res.json()) as { current: string; latest: string }
          if (data.current === installedVersion) {
            clearPoll()
            markUpdateApplied(installedVersion)
            window.location.reload()
            return
          }
        } catch {
          // Tolerate network errors during the restart window.
        }

        if (!mountedRef.current) {
          clearPoll()
          return
        }

        pollTimerRef.current = setTimeout(() => {
          void tick()
        }, POLL_INTERVAL_MS)
      }

      pollTimerRef.current = setTimeout(() => {
        void tick()
      }, POLL_INTERVAL_MS)
    },
    [clearPoll, enterRestartFailed, markUpdateApplied, t],
  )

  const handleUpdate = useCallback(async () => {
    setState('updating')
    setErrorMessage(null)

    try {
      const res = await authFetch('/api/auto-update', { method: 'POST' })
      const data = (await res.json()) as { success: boolean; version?: string; error?: string; isService: boolean }

      if (data.success) {
        const version = data.version ?? 'unknown'
        setUpdatedVersion(version)
        setRestartAvailable(Boolean(data.isService))
        // Read the checkbox at completion time — the user may have toggled it
        // while the download was in flight.
        if (autoRestartRef.current && data.isService) {
          void restartAndPoll(version)
        } else {
          setState('complete')
        }
      } else {
        setErrorMessage(data.error ?? t({ en: 'Update failed', fr: 'Échec de la mise à jour' }))
        setState('failed')
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : t({ en: 'Update request failed', fr: 'La demande de mise à jour a échoué' }),
      )
      setState('failed')
    }
  }, [restartAndPoll, t])

  const handleRestartNow = useCallback(() => {
    const installedVersion = updatedVersion ?? modalVersionInfo?.latest ?? null
    if (!installedVersion) {
      enterRestartFailed(
        t({
          en: 'Installed version unknown; cannot verify restart.',
          fr: 'Version installée inconnue ; redémarrage impossible à vérifier.',
        }),
      )
      return
    }
    void restartAndPoll(installedVersion)
  }, [updatedVersion, modalVersionInfo, enterRestartFailed, restartAndPoll, t])

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearPoll()
    }
  }, [clearPoll])

  useEffect(() => {
    if (isOpen) {
      setProgressDots('')
      clearPoll()
      setState('ready')
      setUpdatedVersion(null)
      setErrorMessage(null)
      setRestartAvailable(false)
      setServiceMode(false)
      toggleAutoRestart(false)
    }
  }, [isOpen, clearPoll, toggleAutoRestart])

  const canClose = state !== 'updating' && state !== 'restarting'

  const formatVersion = (version: string) => {
    if (isDev) {
      return version.replace(/-dev$/, '')
    }
    return version
  }

  const title =
    state === 'failed'
      ? t({ en: 'Update Failed', fr: 'Échec de la mise à jour' })
      : state === 'restarting'
        ? t({ en: 'Restarting…', fr: 'Redémarrage…' })
        : state === 'complete'
          ? t({ en: 'Update Complete', fr: 'Mise à jour terminée' })
          : state === 'restartFailed'
            ? t({ en: 'Restart Not Confirmed', fr: 'Redémarrage non confirmé' })
            : isDev
              ? t({ en: 'New OpenFox (dev) version available', fr: 'Nouvelle version OpenFox (dev) disponible' })
              : t({ en: 'New OpenFox version available', fr: 'Nouvelle version d’OpenFox disponible' })

  return (
    <Modal
      isOpen={isOpen}
      onClose={canClose ? onClose : undefined}
      title={title}
      size="md"
      closeOnBackdropClick={canClose}
      showCloseButton={canClose}
      footer={
        <div className="flex flex-col gap-2">
          {state === 'ready' && (
            <button
              onClick={handleUpdate}
              className="w-full px-3 py-2 text-sm rounded bg-accent-primary hover:brightness-110 transition-all text-white font-medium"
            >
              {t({ en: 'Update OpenFox', fr: 'Mettre à jour OpenFox' })}
            </button>
          )}

          {/* Service installs can opt into an automatic restart; the checkbox stays
              live through the download so the decision can be made mid-update. */}
          {(state === 'ready' || state === 'updating') && serviceMode && (
            <label className="flex items-center justify-center gap-2 text-xs text-text-muted cursor-pointer select-none">
              <input type="checkbox" checked={autoRestart} onChange={(e) => toggleAutoRestart(e.target.checked)} />
              {t({
                en: 'Auto-restart once update is done',
                fr: 'Redémarrer automatiquement une fois la mise à jour terminée',
              })}
            </label>
          )}

          {state === 'complete' && restartAvailable && (
            <div className="flex flex-col gap-2">
              <button
                onClick={handleRestartNow}
                className="w-full px-3 py-2 text-sm rounded bg-accent-primary hover:brightness-110 transition-all text-white font-medium"
              >
                {t({ en: 'Restart OpenFox now', fr: 'Redémarrer OpenFox maintenant' })}
              </button>
              <button
                onClick={onClose}
                className="w-full px-3 py-2 text-sm rounded bg-bg-tertiary hover:bg-bg-secondary transition-colors text-text-primary font-medium"
              >
                {t({ en: 'Later', fr: 'Plus tard' })}
              </button>
            </div>
          )}

          {state === 'complete' && !restartAvailable && (
            <button
              onClick={onClose}
              className="w-full px-3 py-2 text-sm rounded bg-bg-tertiary hover:bg-bg-secondary transition-colors text-text-primary font-medium"
            >
              {t({ en: 'Close', fr: 'Fermer' })}
            </button>
          )}

          {(state === 'failed' || state === 'restartFailed') && (
            <button
              onClick={onClose}
              className="w-full px-3 py-2 text-sm rounded bg-bg-tertiary hover:bg-bg-secondary transition-colors text-text-primary font-medium"
            >
              {t({ en: 'Close', fr: 'Fermer' })}
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {modalVersionInfo && (
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">{t({ en: 'Current version', fr: 'Version actuelle' })}</span>
            <span className="text-text-primary font-mono">{formatVersion(modalVersionInfo.current)}</span>
          </div>
        )}
        {modalVersionInfo && (
          <div className="flex justify-between text-sm pb-2">
            <span className="text-text-muted">{t({ en: 'Latest version', fr: 'Dernière version' })}</span>
            <span className="text-accent-primary font-mono font-semibold">{modalVersionInfo.latest}</span>
          </div>
        )}

        {(state === 'updating' || state === 'restarting') && (
          <div className="flex flex-col gap-2 mt-2">
            <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div className="h-full bg-accent-primary animate-pulse w-full" />
            </div>
            <p className="text-xs text-text-muted text-center">
              {state === 'restarting'
                ? t({ en: 'Restarting', fr: 'Redémarrage' })
                : t({ en: 'Updating', fr: 'Mise à jour' })}
              {progressDots}
            </p>
          </div>
        )}

        {state === 'complete' && (
          <div className="flex flex-col gap-3 mt-2">
            <div className="bg-bg-tertiary rounded px-3 py-2 text-xs text-text-secondary">
              {t(
                {
                  en: 'OpenFox has been updated to v{{version}}.',
                  fr: 'OpenFox a été mis à jour vers la v{{version}}.',
                },
                { version: updatedVersion ?? modalVersionInfo?.latest ?? '' },
              )}{' '}
              {restartAvailable
                ? t({
                    en: 'Click "Restart OpenFox now" to apply the update.',
                    fr: 'Cliquez sur « Redémarrer OpenFox maintenant » pour appliquer la mise à jour.',
                  })
                : t({
                    en: 'Please restart OpenFox to use the new version.',
                    fr: 'Veuillez redémarrer OpenFox pour utiliser la nouvelle version.',
                  })}
            </div>
          </div>
        )}

        {state === 'failed' && (
          <FallbackPanel
            message={errorMessage}
            command="openfox update"
            hint={{
              en: 'Run this command in your terminal to complete the update.',
              fr: 'Exécutez cette commande dans votre terminal pour terminer la mise à jour.',
            }}
          />
        )}

        {state === 'restartFailed' && (
          <FallbackPanel
            message={errorMessage}
            command="openfox service restart"
            hint={{
              en: 'Run this command in your terminal to restart OpenFox.',
              fr: 'Exécutez cette commande dans votre terminal pour redémarrer OpenFox.',
            }}
          />
        )}
      </div>
    </Modal>
  )
}
