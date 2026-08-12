import { ScrollArea } from '../shared/ScrollArea'
import { useState, useRef, useEffect, useCallback } from 'react'
import { wsClient } from '../../lib/ws'
import { Modal } from '../shared/SelfContainedModal'
import { UnifiedDiffViewer } from '../shared/DiffView'
import type { DiffLine } from '@shared/protocol.js'
import { useSessionScope } from '../../stores/session/session-scope'

interface DynamicContextPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  isRunning: boolean
  onApply: () => void
}

export function DynamicContextPreviewModal({ isOpen, onClose, isRunning, onApply }: DynamicContextPreviewModalProps) {
  const sessionId = useSessionScope()
  const [diffPreview, setDiffPreview] = useState<DiffLine[] | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const pendingPreviewRequestId = useRef<string | null>(null)

  const fetchPreview = useCallback(() => {
    setIsLoadingPreview(true)
    const requestId = wsClient.send('context.applyDynamic.preview', { ...(sessionId ? { sessionId } : {}) })
    pendingPreviewRequestId.current = requestId

    const unsubscribe = wsClient.subscribe((message) => {
      if (message.id === requestId && message.type === 'context.preview') {
        const payload = message.payload as { diff: DiffLine[] }
        setDiffPreview(payload.diff ?? [])
        setIsLoadingPreview(false)
        pendingPreviewRequestId.current = null
        unsubscribe()
      }
    })

    setTimeout(() => {
      if (pendingPreviewRequestId.current === requestId) {
        setIsLoadingPreview(false)
        pendingPreviewRequestId.current = null
        unsubscribe()
      }
    }, 5000)
  }, [])

  useEffect(() => {
    if (isOpen) {
      setDiffPreview(null)
      setIsLoadingPreview(true)
      fetchPreview()
    }
  }, [isOpen, fetchPreview])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Update system prompt" size="lg">
      <p className="text-sm text-text-secondary mb-4">
        Applying the new system prompt will rebuild the cached prompt, which may cause the next response to take longer
        while the LLM reprocesses the prefix.
        {isRunning && (
          <>
            {' '}
            Since the session is currently running, the update will be queued and applied at the start of the next turn.
          </>
        )}
      </p>
      {isLoadingPreview ? (
        <div className="py-8 text-center text-text-muted">Loading diff...</div>
      ) : diffPreview && diffPreview.length > 0 ? (
        <ScrollArea className="max-h-[60vh] border border-border rounded-lg">
          <UnifiedDiffViewer diff={diffPreview} />
        </ScrollArea>
      ) : (
        <p className="text-sm text-text-tertiary mb-4">
          The system prompt hash has changed (e.g., due to tool or skill changes), but the actual prompt text appears
          identical. Applying the update will still rebuild the cached prompt to ensure consistency.
        </p>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded bg-bg-tertiary text-text-primary hover:bg-border transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onApply}
          className="px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:opacity-90 transition-colors"
        >
          {isRunning ? 'Queue update' : 'Update'}
        </button>
      </div>
    </Modal>
  )
}
