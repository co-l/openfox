import { useState } from 'react'
import { useSessionStore } from '../../stores/session'
import { ProgressBar, LowTokenWarning } from '../shared/ProgressBar'
import { formatTokens } from '../../lib/format-stats'
import { wsClient } from '../../lib/ws'
import { MoreIcon } from '../shared/icons'
import { getTextColor } from './token-utils'
import { ApplyDynamicModal } from './ApplyDynamicModal'

interface ContextPopoverProps {
  variant?: 'popover' | 'sidebar'
}

export function ContextPopover({ variant = 'popover' }: ContextPopoverProps) {
  const contextState = useSessionStore((state) => state.contextState)
  const currentSession = useSessionStore((state) => state.currentSession)
  const compactContext = useSessionStore((state) => state.compactContext)

  const [showApplyModal, setShowApplyModal] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  if (!contextState || !currentSession) return null

  const { currentTokens, maxTokens, compactionCount, dangerZone, dynamicContextChanged } = contextState
  const percent = Math.round((currentTokens / maxTokens) * 100)
  const isRunning = currentSession.isRunning

  const handleApplyDynamic = () => {
    wsClient.send('context.applyDynamic', {})
    setShowApplyModal(false)
  }

  const isSidebar = variant === 'sidebar'

  const tokenDisplay = (
    <span className={getTextColor(percent, dangerZone)}>
      {formatTokens(currentTokens)} / {formatTokens(maxTokens)} ({percent}%)
    </span>
  )

  const progressSlot = (
    <div className="flex items-center gap-2">
      <ProgressBar percent={percent} dangerZone={dangerZone} className="flex-1" />
      <LowTokenWarning dangerZone={dangerZone} />
      {compactionCount > 0 && (
        <span className="text-[10px] text-text-muted bg-bg-tertiary px-1 py-0.5 rounded">{compactionCount}x</span>
      )}
    </div>
  )

  const menuSlot = (
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
  )

  const applyModal = (
    <ApplyDynamicModal
      isOpen={showApplyModal}
      onClose={() => setShowApplyModal(false)}
      onApply={handleApplyDynamic}
      disabled={isRunning}
    />
  )

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
            if (!isRunning) compactContext()
          }}
          disabled={isRunning}
          className="w-full px-3 py-1.5 text-left text-sm hover:bg-bg-tertiary transition-colors disabled:opacity-40 disabled:cursor-not-allowed rounded"
          title={isRunning ? 'Cannot compact while running' : 'Compact context'}
        >
          <span className={dangerZone ? 'text-accent-error' : ''}>Compact</span>
        </button>
        {dynamicContextChanged && (
          <button
            onClick={() => setShowApplyModal(true)}
            disabled={isRunning}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-bg-tertiary transition-colors disabled:opacity-40 disabled:cursor-not-allowed rounded"
            title={isRunning ? 'Cannot apply while running' : 'Apply dynamic context'}
          >
            <span className="text-accent-warning">Update system prompt</span>
          </button>
        )}
      </div>
      {applyModal}
    </div>
  )
}
