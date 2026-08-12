import { useState, useRef, useEffect } from 'react'
import { useSessionStore } from '../../stores/session'
import { XCloseIcon } from '../shared/icons'
import { DynamicContextPreviewModal } from './DynamicContextPreviewModal'
import { useApplyDynamicContext, useScopedContext } from '../../stores/session/session-scope'

export function SessionHeader() {
  const { sessionId, contextState, currentSession } = useScopedContext()
  const pendingUpdate = useSessionStore((state) => state.pendingUpdate)
  const triggerPendingUpdate = useSessionStore((state) => state.triggerPendingUpdate)
  const applyDynamicContext = useApplyDynamicContext()

  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [showApplyModal, setShowApplyModal] = useState(false)
  const prevDynamicChanged = useRef(false)
  const prevIsRunning = useRef(false)

  useEffect(() => {
    if (contextState?.dynamicContextChanged && !prevDynamicChanged.current) {
      setBannerDismissed(false)
    }
    prevDynamicChanged.current = contextState?.dynamicContextChanged ?? false
  }, [contextState?.dynamicContextChanged])

  useEffect(() => {
    const isRunning = currentSession?.isRunning ?? false
    if (prevIsRunning.current && !isRunning && pendingUpdate && pendingUpdate === sessionId) {
      triggerPendingUpdate()
    }
    prevIsRunning.current = isRunning
  }, [currentSession?.isRunning, pendingUpdate, sessionId, triggerPendingUpdate])

  if (!contextState || !currentSession) {
    return null
  }

  const { dynamicContextChanged } = contextState
  const isRunning = currentSession.isRunning

  const handleApplyDynamic = () => {
    applyDynamicContext(isRunning)
    setBannerDismissed(true)
    setShowApplyModal(false)
  }

  return (
    <>
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

      <DynamicContextPreviewModal
        isOpen={showApplyModal}
        onClose={() => setShowApplyModal(false)}
        isRunning={isRunning}
        onApply={handleApplyDynamic}
      />
    </>
  )
}

export { SessionHeader as ContextHeader }
