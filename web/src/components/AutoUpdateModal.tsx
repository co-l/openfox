import { useState, useEffect, useCallback } from 'react'
import { Modal } from './shared/Modal'
import { authFetch } from '../lib/api'

type ModalState = 'ready' | 'updating' | 'restarting' | 'complete' | 'failed'

interface AutoUpdateModalProps {
  isOpen: boolean
  onClose: () => void
  versionInfo: { current: string; latest: string } | null
}

export function AutoUpdateModal({ isOpen, onClose, versionInfo }: AutoUpdateModalProps) {
  const [state, setState] = useState<ModalState>('ready')
  const [progressDots, setProgressDots] = useState('')
  const [modalVersionInfo, setModalVersionInfo] = useState(versionInfo)
  const [updatedVersion, setUpdatedVersion] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isDev = import.meta.env.DEV

  // Auto-fetch only once when modal opens and no versionInfo provided
  useEffect(() => {
    if (!isOpen || versionInfo) return
    fetch('/api/auto-update/check')
      .then((res) => res.json())
      .then((data) => {
        setModalVersionInfo({ current: data.current, latest: data.latest })
      })
      .catch(() => {})
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || (state !== 'updating' && state !== 'restarting')) return
    const dots = setInterval(() => {
      setProgressDots((d) => (d.length >= 3 ? '' : d + '.'))
    }, 400)
    return () => clearInterval(dots)
  }, [isOpen, state])

  const handleUpdate = useCallback(async () => {
    setState('updating')
    setErrorMessage(null)

    try {
      const res = await authFetch('/api/auto-update', { method: 'POST' })
      const data = (await res.json()) as { success: boolean; version?: string; error?: string; isService: boolean }

      if (data.success) {
        const version = data.version ?? 'unknown'
        setUpdatedVersion(version)
        localStorage.setItem('openfox_updated_to', version)
        localStorage.setItem('update_pending', 'true')

        if (data.isService) {
          setState('restarting')
          await authFetch('/api/auto-update/restart', { method: 'POST' }).catch(() => {})
          setTimeout(() => window.location.reload(), 5_000)
        } else {
          setState('complete')
        }
      } else {
        setErrorMessage(data.error ?? 'Update failed')
        setState('failed')
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Update request failed')
      setState('failed')
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      setState('ready')
      setProgressDots('')
      setUpdatedVersion(null)
      setErrorMessage(null)
    }
  }, [isOpen])

  const canClose = state !== 'updating' && state !== 'restarting'

  const formatVersion = (version: string) => {
    if (isDev) {
      return version.replace(/-dev$/, '')
    }
    return version
  }

  const title =
    state === 'failed'
      ? 'Update Failed'
      : state === 'complete' || state === 'restarting'
        ? 'Update Complete'
        : isDev
          ? 'New OpenFox (dev) version available'
          : 'New OpenFox version available'

  return (
    <Modal
      isOpen={isOpen}
      onClose={canClose ? onClose : undefined}
      title={title}
      size="md"
      closeOnBackdropClick={canClose}
      showCloseButton={canClose}
    >
      <div className="flex flex-col gap-4">
        {modalVersionInfo && (
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Current version</span>
            <span className="text-text-primary font-mono">{formatVersion(modalVersionInfo.current)}</span>
          </div>
        )}
        {modalVersionInfo && (
          <div className="flex justify-between text-sm pb-2">
            <span className="text-text-muted">Latest version</span>
            <span className="text-accent-primary font-mono font-semibold">{modalVersionInfo.latest}</span>
          </div>
        )}

        {(state === 'updating' || state === 'restarting') && (
          <div className="flex flex-col gap-2 mt-2">
            <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div className="h-full bg-accent-primary animate-pulse w-full" />
            </div>
            <p className="text-xs text-text-muted text-center">
              {state === 'restarting' ? 'Restarting' : 'Updating'}
              {progressDots}
            </p>
          </div>
        )}

        {state === 'complete' && (
          <div className="flex flex-col gap-3 mt-2">
            <div className="bg-bg-tertiary rounded px-3 py-2 text-xs text-text-secondary">
              OpenFox has been updated to v{updatedVersion ?? modalVersionInfo?.latest}.
              {' Please restart OpenFox to use the new version.'}
            </div>
          </div>
        )}

        {state === 'failed' && (
          <div className="flex flex-col gap-3 mt-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-accent-danger/10 border border-accent-danger/30 rounded text-xs">
              <span>⚠️</span>
              <p className="text-text-secondary">{errorMessage}</p>
            </div>
            <div className="bg-bg-tertiary rounded px-3 py-2 text-xs font-mono text-text-secondary">openfox update</div>
            <p className="text-xs text-text-muted">Run this command in your terminal to complete the update.</p>
          </div>
        )}
      </div>

      {state === 'ready' && (
        <button
          onClick={handleUpdate}
          className="w-full px-3 py-2 text-sm rounded bg-accent-primary hover:brightness-110 transition-all text-white font-medium"
        >
          Update OpenFox
        </button>
      )}

      {(state === 'complete' || state === 'failed') && (
        <button
          onClick={onClose}
          className="w-full px-3 py-2 text-sm rounded bg-bg-tertiary hover:bg-bg-secondary transition-colors text-text-primary font-medium mt-2"
        >
          Close
        </button>
      )}
    </Modal>
  )
}
