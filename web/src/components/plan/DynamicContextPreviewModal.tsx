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
  const [toolDiffPreview, setToolDiffPreview] = useState<DiffLine[]>([])
  const [hasBaseline, setHasBaseline] = useState(false)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const pendingPreviewRequestId = useRef<string | null>(null)

  const fetchPreview = useCallback(() => {
    setIsLoadingPreview(true)
    const requestId = wsClient.send('context.applyDynamic.preview', { ...(sessionId ? { sessionId } : {}) })
    pendingPreviewRequestId.current = requestId

    const unsubscribe = wsClient.subscribe((message) => {
      if (message.id === requestId && message.type === 'context.preview') {
        const payload = message.payload as { diff: DiffLine[]; toolDiff?: DiffLine[]; oldPrompt?: string }
        setDiffPreview(payload.diff ?? [])
        setToolDiffPreview(payload.toolDiff ?? [])
        setHasBaseline(payload.oldPrompt !== undefined)
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
      setToolDiffPreview([])
      setHasBaseline(false)
      setIsLoadingPreview(true)
      fetchPreview()
    }
  }, [isOpen, fetchPreview])

  const hasDiff = diffPreview !== null && diffPreview.length > 0
  const hasToolDiff = toolDiffPreview.length > 0

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Update system prompt"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
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
      }
    >
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
      ) : hasDiff || hasToolDiff ? (
        <ScrollArea className="max-h-[60vh] border border-border rounded-lg">
          {hasDiff && <UnifiedDiffViewer diff={diffPreview} />}
          {hasToolDiff && (
            <div>
              {hasDiff && <div className="border-t border-border" />}
              <div className="px-2 py-1 text-xs font-semibold text-text-muted uppercase tracking-wide">
                Tools ({toolDiffPreview.filter((l) => l.type === 'added').length} added,{' '}
                {toolDiffPreview.filter((l) => l.type === 'removed').length} removed)
              </div>
              <UnifiedDiffViewer diff={toolDiffPreview} hideHeader />
            </div>
          )}
        </ScrollArea>
      ) : hasBaseline ? (
        <p className="text-sm text-text-tertiary mb-4">
          The system prompt hash has changed (e.g., due to tool or skill changes), but the actual prompt text appears
          identical. Applying the update will still rebuild the cached prompt to ensure consistency.
        </p>
      ) : (
        <p className="text-sm text-text-tertiary mb-4">
          The cached system prompt will be built with the current tools and settings on apply.
        </p>
      )}
    </Modal>
  )
}
