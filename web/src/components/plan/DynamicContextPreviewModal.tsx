import { ScrollArea } from '../shared/ScrollArea'
import { useState, useRef, useEffect, useCallback } from 'react'
import { wsClient } from '../../lib/ws'
import { useT } from '../../hooks/useT'
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
  const t = useT()
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
      title={t({ en: 'Rebase system prompt', fr: 'Redéfinir le prompt système' })}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded bg-bg-tertiary text-text-primary hover:bg-border transition-colors"
          >
            {t({ en: 'Cancel', fr: 'Annuler' })}
          </button>
          <button
            onClick={onApply}
            className="px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:opacity-90 transition-colors"
          >
            {isRunning
              ? t({ en: 'Queue update', fr: 'Mettre en file la mise à jour' })
              : t({ en: 'Update', fr: 'Mettre à jour' })}
          </button>
        </div>
      }
    >
      <p className="text-sm text-text-secondary mb-4">
        {t({
          en: 'Applying the new system prompt will rebuild the cached prompt, which may cause the next response to take longer while the LLM reprocesses the prefix.',
          fr: 'L’application du nouveau prompt système reconstruira le prompt en cache, ce qui peut ralentir la prochaine réponse pendant que le LLM retraite le préfixe.',
        })}
        {isRunning && (
          <>
            {' '}
            {t({
              en: 'Since the session is currently running, the update will be queued and applied at the start of the next turn.',
              fr: 'Comme la session est en cours, la mise à jour sera mise en file et appliquée au début du prochain tour.',
            })}
          </>
        )}
      </p>
      {isLoadingPreview ? (
        <div className="py-8 text-center text-text-muted">
          {t({ en: 'Loading diff...', fr: 'Chargement du diff…' })}
        </div>
      ) : hasDiff || hasToolDiff ? (
        <ScrollArea className="max-h-[60vh] border border-border rounded-lg">
          {hasDiff && <UnifiedDiffViewer diff={diffPreview} />}
          {hasToolDiff && (
            <div>
              {hasDiff && <div className="border-t border-border" />}
              <div className="px-2 py-1 text-xs font-semibold text-text-muted uppercase tracking-wide">
                {t(
                  {
                    en: 'Tools ({{added}} added, {{removed}} removed)',
                    fr: 'Outils ({{added}} ajoutés, {{removed}} supprimés)',
                  },
                  {
                    added: toolDiffPreview.filter((l) => l.type === 'added').length,
                    removed: toolDiffPreview.filter((l) => l.type === 'removed').length,
                  },
                )}
              </div>
              <UnifiedDiffViewer diff={toolDiffPreview} hideHeader />
            </div>
          )}
        </ScrollArea>
      ) : hasBaseline ? (
        <p className="text-sm text-text-tertiary mb-4">
          {t({
            en: 'The system prompt hash has changed (e.g., due to tool or skill changes), but the actual prompt text appears identical. Applying the update will still rebuild the cached prompt to ensure consistency.',
            fr: 'Le hachage du prompt système a changé (par ex. suite à des changements d’outils ou de compétences), mais le texte du prompt semble identique. L’application de la mise à jour reconstruira néanmoins le prompt en cache pour garantir la cohérence.',
          })}
        </p>
      ) : (
        <p className="text-sm text-text-tertiary mb-4">
          {t({
            en: 'The cached system prompt will be built with the current tools and settings on apply.',
            fr: 'Le prompt système en cache sera construit avec les outils et paramètres actuels lors de l’application.',
          })}
        </p>
      )}
    </Modal>
  )
}
