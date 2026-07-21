import { useState, useRef, useEffect } from 'react'
import { useSessionStore } from '../../stores/session'
import { MoreIcon, XCloseIcon } from '../shared/icons'
import { ProgressBar, LowTokenWarning } from '../shared/ProgressBar'
import { formatTokens } from '../../lib/format-stats'
import { wsClient } from '../../lib/ws'
import { Modal } from '../shared/SelfContainedModal'

function getTextColor(percent: number, dangerZone: boolean): string {
  if (dangerZone) return 'text-accent-error'
  if (percent > 85) return 'text-accent-error'
  if (percent > 60) return 'text-accent-warning'
  return 'text-text-muted'
}

export function SessionHeader() {
  const contextState = useSessionStore((state) => state.contextState)
  const currentSession = useSessionStore((state) => state.currentSession)
  const compactContext = useSessionStore((state) => state.compactContext)

  const [menuOpen, setMenuOpen] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [showApplyModal, setShowApplyModal] = useState(false)
  const prevDynamicChanged = useRef(false)

  useEffect(() => {
    if (contextState?.dynamicContextChanged && !prevDynamicChanged.current) {
      setBannerDismissed(false)
    }
    prevDynamicChanged.current = contextState?.dynamicContextChanged ?? false
  }, [contextState?.dynamicContextChanged])

  if (!contextState || !currentSession) {
    return null
  }

  const { currentTokens, maxTokens, compactionCount, dangerZone, dynamicContextChanged } = contextState
  const percent = Math.round((currentTokens / maxTokens) * 100)
  const isRunning = currentSession.isRunning

  const handleApplyDynamic = () => {
    wsClient.send('context.applyDynamic', {})
    setBannerDismissed(true)
  }

  return (
    <>
      <div className="flex-shrink-0 px-4 py-1.5 border-b border-border bg-secondary">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <span className={getTextColor(percent, dangerZone)}>
              {formatTokens(currentTokens)} / {formatTokens(maxTokens)}
            </span>
            <span className={getTextColor(percent, dangerZone)}>({percent}%)</span>

            <ProgressBar percent={percent} dangerZone={dangerZone} />
            <LowTokenWarning dangerZone={dangerZone} />

            {compactionCount > 0 && (
              <span className="text-[10px] text-text-muted bg-bg-tertiary px-1 py-0.5 rounded">{compactionCount}x</span>
            )}
          </div>

          <div className="flex-1 flex justify-end">
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
                title="More options"
              >
                <MoreIcon />
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-50 bg-bg-secondary border border-border rounded-lg shadow-xl py-1 min-w-[160px]">
                    <button
                      onClick={() => {
                        if (!isRunning) compactContext()
                        setMenuOpen(false)
                      }}
                      disabled={isRunning}
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-bg-tertiary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={isRunning ? 'Cannot compact while running' : 'Compact context'}
                    >
                      <span className={dangerZone ? 'text-accent-error' : ''}>Compact</span>
                    </button>
                    {dynamicContextChanged && (
                      <button
                        onClick={() => {
                          setMenuOpen(false)
                          setShowApplyModal(true)
                        }}
                        disabled={isRunning}
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-bg-tertiary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={isRunning ? 'Cannot apply while running' : 'Apply dynamic context'}
                      >
                        <span className="text-accent-warning">Update system prompt</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {dynamicContextChanged && !bannerDismissed && (
        <div className="flex-shrink-0 px-4 py-2 bg-accent-warning/10 border-b border-accent-warning/30">
          <div className="flex items-center justify-between">
            <div className="flex-1 flex items-center justify-center gap-1 text-sm text-text-secondary">
              <span>System prompt has changed —</span>
              <button
                onClick={() => setShowApplyModal(true)}
                className="underline hover:text-text-primary transition-colors"
              >
                click here to update it
              </button>
            </div>
            <button
              onClick={() => setBannerDismissed(true)}
              className="flex-shrink-0 p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
              title="Dismiss"
            >
              <XCloseIcon />
            </button>
          </div>
        </div>
      )}

      <Modal isOpen={showApplyModal} onClose={() => setShowApplyModal(false)} title="Update system prompt" size="sm">
        <p className="text-sm text-text-secondary mb-4">
          Applying the new system prompt will rebuild the cached prompt, which may cause the next response to take
          longer while the LLM reprocesses the prefix.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setShowApplyModal(false)}
            className="px-3 py-1.5 text-sm rounded bg-bg-tertiary text-text-primary hover:bg-border transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              handleApplyDynamic()
              setShowApplyModal(false)
            }}
            disabled={isRunning}
            className="px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Update
          </button>
        </div>
      </Modal>
    </>
  )
}

export { SessionHeader as ContextHeader }
