import { useState } from 'react'
import { useSessionStore } from '../../stores/session'
import { useT } from '../../hooks/useT'
import { ProgressBar, LowTokenWarning } from '../shared/ProgressBar'
import { formatTokens } from '../../lib/format-stats'
import { MoreIcon } from '../shared/icons'
import { getTextColor } from './token-utils'
import { DynamicContextPreviewModal } from './DynamicContextPreviewModal'
import { useApplyDynamicContext, useScopedContext } from '../../stores/session/session-scope'

interface ContextPopoverProps {
  variant?: 'popover' | 'sidebar'
  onUpdateSystemPrompt?: () => void
}

function RebaseIndicator() {
  const t = useT()
  return (
    <span
      className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-accent-warning"
      aria-label={t({
        en: 'System prompt changes available',
        fr: 'Des modifications du prompt système sont disponibles',
      })}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-accent-warning" />
      {t({ en: 'changes', fr: 'modifications' })}
    </span>
  )
}

export function ContextPopover({ variant = 'popover', onUpdateSystemPrompt }: ContextPopoverProps) {
  const t = useT()
  const { sessionId, contextState, currentSession } = useScopedContext()
  const compactContext = useSessionStore((state) => state.compactContext)
  const applyDynamicContext = useApplyDynamicContext()

  const [showApplyModal, setShowApplyModal] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  if (!contextState || !currentSession) return null

  const { currentTokens, maxTokens, compactionCount, dangerZone } = contextState
  const percent = Math.round((currentTokens / maxTokens) * 100)
  const isRunning = currentSession.isRunning
  const needsRebase = contextState.dynamicContextChanged === true

  const handleApplyDynamic = () => {
    applyDynamicContext(isRunning)
    setShowApplyModal(false)
  }

  const isSidebar = variant === 'sidebar'

  const tokenDisplay = (
    <span className={getTextColor(percent, dangerZone)}>
      {`${formatTokens(currentTokens)} / ${formatTokens(maxTokens)} (${percent}%)`}
    </span>
  )

  const progressSlot = (
    <div className="flex items-center gap-2">
      <ProgressBar percent={percent} dangerZone={dangerZone} className="flex-1" />
      <LowTokenWarning dangerZone={dangerZone} />
      {compactionCount > 0 && (
        <span className="text-[10px] text-text-muted bg-bg-tertiary px-1 py-0.5 rounded">{`${compactionCount}x`}</span>
      )}
    </div>
  )

  const menuSlot = (
    <div className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
        title={t({ en: 'More options', fr: 'Plus d’options' })}
      >
        <MoreIcon />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-50 bg-bg-secondary border border-border rounded-lg shadow-xl py-1 min-w-[160px]">
            <button
              onClick={() => {
                if (!isRunning && sessionId) compactContext(sessionId)
                setMenuOpen(false)
              }}
              disabled={isRunning}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-bg-tertiary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                isRunning
                  ? t({ en: 'Cannot compact while running', fr: 'Impossible de compresser pendant l’exécution' })
                  : t({ en: 'Compact context', fr: 'Compresser le contexte' })
              }
            >
              <span className={dangerZone ? 'text-accent-error' : ''}>{t({ en: 'Compact', fr: 'Compresser' })}</span>
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                if (onUpdateSystemPrompt) onUpdateSystemPrompt()
                else setShowApplyModal(true)
              }}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-bg-tertiary transition-colors"
              title={t({
                en: 'Preview and apply system prompt changes',
                fr: 'Aperçu et application des modifications du prompt système',
              })}
            >
              <span className="text-accent-warning">
                {t({ en: 'Rebase system prompt', fr: 'Redéfinir le prompt système' })}
              </span>
              {needsRebase && <RebaseIndicator />}
            </button>
          </div>
        </>
      )}
    </div>
  )

  const applyModal = !onUpdateSystemPrompt ? (
    <DynamicContextPreviewModal
      isOpen={showApplyModal}
      onClose={() => setShowApplyModal(false)}
      isRunning={isRunning}
      onApply={handleApplyDynamic}
    />
  ) : null

  if (isSidebar) {
    return (
      <>
        <div className="flex items-start gap-2 mb-4">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="text-sm">{tokenDisplay}</div>
            {progressSlot}
          </div>
          <div className="shrink-0 pt-0.5">{menuSlot}</div>
        </div>
        {applyModal}
      </>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">{tokenDisplay}</div>
        {progressSlot}
      </div>

      <div className="space-y-1">
        <button
          onClick={() => {
            if (!isRunning && sessionId) compactContext(sessionId)
          }}
          disabled={isRunning}
          className="w-full px-3 py-1.5 text-left text-sm hover:bg-bg-tertiary transition-colors disabled:opacity-40 disabled:cursor-not-allowed rounded"
          title={
            isRunning
              ? t({ en: 'Cannot compact while running', fr: 'Impossible de compresser pendant l’exécution' })
              : t({ en: 'Compact context', fr: 'Compresser le contexte' })
          }
        >
          <span className={dangerZone ? 'text-accent-error' : ''}>{t({ en: 'Compact', fr: 'Compresser' })}</span>
        </button>
        <button
          onClick={() => {
            if (onUpdateSystemPrompt) onUpdateSystemPrompt()
            else setShowApplyModal(true)
          }}
          className="w-full px-3 py-1.5 text-left text-sm hover:bg-bg-tertiary transition-colors rounded"
          title={t({
            en: 'Preview and apply system prompt changes',
            fr: 'Aperçu et application des modifications du prompt système',
          })}
        >
          <span className="text-accent-warning">
            {t({ en: 'Rebase system prompt', fr: 'Redéfinir le prompt système' })}
          </span>
          {needsRebase && <RebaseIndicator />}
        </button>
      </div>
      {applyModal}
    </div>
  )
}
