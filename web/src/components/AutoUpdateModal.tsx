import { useState, useEffect, useCallback, useRef } from 'react'
import { Modal } from './shared/Modal'
import { authFetch } from '../lib/api'

type ModalState = 'ready' | 'updating' | 'reloading' | 'complete' | 'failed'
type TimeoutPhase = 'waiting' | 'takingLonger' | 'failed'

interface AutoUpdateModalProps {
  isOpen: boolean
  onClose: () => void
  versionInfo: { current: string; latest: string } | null
}

export function AutoUpdateModal({ isOpen, onClose, versionInfo }: AutoUpdateModalProps) {
  const [state, setState] = useState<ModalState>('ready')
  const [timeoutPhase, setTimeoutPhase] = useState<TimeoutPhase>('waiting')
  const [progressDots, setProgressDots] = useState('')
  const [modalVersionInfo, setModalVersionInfo] = useState(versionInfo)
  const [isService, setIsService] = useState(false)
  const diedRef = useRef(false)

  useEffect(() => {
    if (!isOpen) return
    if (versionInfo) {
      setModalVersionInfo(versionInfo)
      return
    }
    fetch('/api/auto-update/check')
      .then((res) => res.json())
      .then((data) => {
        setModalVersionInfo({ current: data.current, latest: data.latest })
        setIsService(data.isService ?? false)
      })
      .catch(() => {})
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || state !== 'updating') return
    const dots = setInterval(() => {
      setProgressDots((d) => (d.length >= 3 ? '' : d + '.'))
    }, 400)
    return () => clearInterval(dots)
  }, [isOpen, state])

  const handleUpdate = useCallback(async () => {
    setState('updating')
    setTimeoutPhase('waiting')
    diedRef.current = false

    const isTestMode = modalVersionInfo?.current === '1.0.0' && modalVersionInfo?.latest === '1.1.0'
    const res = await authFetch('/api/auto-update', { method: 'POST' })
    const { isService: serviceMode } = await res.json()

    if (isTestMode) {
      setTimeout(() => {
        setState('reloading')
        localStorage.setItem('openfox_updated_to', modalVersionInfo?.latest ?? 'unknown')
        localStorage.setItem('update_pending', 'true')
        setTimeout(() => window.location.reload(), 1000)
      }, 5_000)
      return
    }

    if (!serviceMode) {
      setTimeout(() => {
        setState('complete')
      }, 8_000)
      return
    }

    let alive = false

    const poll = setInterval(async () => {
      try {
        const res = await fetch('/api/health')
        if (res.ok) {
          if (diedRef.current) {
            alive = true
            clearInterval(poll)
            setState('reloading')
            localStorage.setItem('openfox_updated_to', modalVersionInfo?.latest ?? 'unknown')
            localStorage.setItem('update_pending', 'true')
            window.location.reload()
          }
        }
      } catch {
        diedRef.current = true
      }
    }, 2000)

    setTimeout(() => {
      if (!alive) {
        setTimeoutPhase('takingLonger')
      }
    }, 60_000)

    setTimeout(() => {
      if (!alive) {
        clearInterval(poll)
        setState('failed')
      }
    }, 120_000)
  }, [modalVersionInfo?.current, modalVersionInfo?.latest])

  useEffect(() => {
    if (isOpen) {
      setState('ready')
      setTimeoutPhase('waiting')
      setProgressDots('')
      diedRef.current = false
    }
  }, [isOpen])

  const canClose = state !== 'updating'

  return (
    <Modal
      isOpen={isOpen}
      onClose={canClose ? onClose : undefined}
      title={
        state === 'failed'
          ? 'Update Failed'
          : state === 'complete'
            ? 'Update Complete'
            : 'New OpenFox Version Available'
      }
      size="sm"
      closeOnBackdropClick={canClose}
      showCloseButton={canClose}
    >
      <div className="flex flex-col gap-4">
        {modalVersionInfo && (
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Current version</span>
            <span className="text-text-primary font-mono">{modalVersionInfo.current}</span>
          </div>
        )}
        {modalVersionInfo && (
          <div className="flex justify-between text-sm pb-2">
            <span className="text-text-muted">Latest version</span>
            <span className="text-accent-primary font-mono font-semibold">{modalVersionInfo.latest}</span>
          </div>
        )}

        {state === 'updating' && (
          <div className="flex flex-col gap-2 mt-2">
            <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div className="h-full bg-accent-primary animate-pulse w-full" />
            </div>
            <p className="text-xs text-text-muted text-center">
              {timeoutPhase === 'takingLonger' ? 'Taking longer than expected\u2026' : `Updating${progressDots}`}
            </p>
          </div>
        )}

        {state === 'reloading' && (
          <div className="flex flex-col gap-2 mt-2">
            <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div className="h-full bg-accent-primary animate-pulse w-full" />
            </div>
            <p className="text-xs text-text-muted text-center">Update complete, reloading{progressDots}</p>
          </div>
        )}

        {state === 'complete' && (
          <div className="flex flex-col gap-3 mt-2">
            <div className="bg-bg-tertiary rounded px-3 py-2 text-xs text-text-secondary">
              OpenFox has been updated to v{modalVersionInfo?.latest}. Please relaunch OpenFox to use the new version.
            </div>
          </div>
        )}

        {state === 'failed' && (
          <div className="flex flex-col gap-3 mt-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-accent-danger/10 border border-accent-danger/30 rounded text-xs">
              <span>⚠️</span>
              <p className="text-text-secondary">The update timed out. The server may need to be updated manually.</p>
            </div>
            <div className="bg-bg-tertiary rounded px-3 py-2 text-xs font-mono text-text-secondary">openfox update</div>
            <p className="text-xs text-text-muted">
              Run this command in your terminal to complete the update, then start the service with{' '}
              <span className="font-mono text-text-secondary">openfox service start</span>.
            </p>
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

      {state === 'ready' && isService && (
        <div className="flex justify-center mt-2">
          <div className="flex items-center gap-2 px-3 py-2 bg-accent-warning/10 border border-accent-warning/30 rounded text-xs">
            <span>⚠️</span>
            <p className="text-text-secondary">
              Server will restart to apply this update. Sessions in progress will be interrupted.
            </p>
          </div>
        </div>
      )}
    </Modal>
  )
}
