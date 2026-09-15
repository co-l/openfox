import { useCallback, useEffect, useState } from 'react'
import { BranchIcon, UserIcon, SpinIcon } from '../shared/icons'
import { useT } from '../../hooks/useT'
import { useSessionStore } from '../../stores/session'
import { getConversationTree, switchConversationBranch } from '../../lib/api'
import type { ConversationTreeTip } from '../../lib/api'
import { formatTime } from '../../lib/format-date'

interface ConversationBranchSectionProps {
  sessionId: string
}

export function ConversationBranchSection({ sessionId }: ConversationBranchSectionProps) {
  const t = useT()
  const isRunning = useSessionStore((s) => s.panes?.[sessionId]?.session?.isRunning ?? false)
  const [tips, setTips] = useState<ConversationTreeTip[]>([])
  const [switchingId, setSwitchingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const tree = await getConversationTree(sessionId)
    if (!tree) return
    setTips((tree.tips ?? []).filter((tip) => tip.type === 'message'))
  }, [sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleSwitch = async (tip: ConversationTreeTip) => {
    if (isRunning || switchingId) return
    setSwitchingId(tip.eventId)
    const ok = await switchConversationBranch(sessionId, tip.eventId)
    setSwitchingId(null)
    if (ok) void refresh()
  }

  if (tips.length === 0) return null

  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <BranchIcon />
        <span className="text-text-secondary">
          {t({ en: 'Conversation branches', fr: 'Branches de conversation' })}
        </span>
        <span className="text-text-muted text-xs">{tips.length}</span>
      </div>
      <div className="h-px bg-border" />
      <div className="space-y-1">
        {tips.map((tip) => {
          const label =
            tip.preview ??
            (tip.role === 'user' ? t({ en: 'You', fr: 'Vous' }) : t({ en: 'Assistant', fr: 'Assistant' }))
          return (
            <button
              key={tip.eventId}
              onClick={() => void handleSwitch(tip)}
              disabled={isRunning || switchingId !== null}
              title={
                isRunning
                  ? t({
                      en: 'Stop the session before switching branches',
                      fr: 'Arrêtez la session avant de changer de branche',
                    })
                  : t({ en: 'Switch to this branch', fr: 'Basculer vers cette branche' })
              }
              className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded bg-bg-tertiary/50 hover:bg-bg-tertiary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tip.role === 'user' ? (
                <UserIcon className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
              ) : (
                <BranchIcon className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
              )}
              <span className="flex-1 min-w-0">
                <span className="block truncate text-sm text-text-secondary">{label}</span>
                <span className="block text-xs text-text-muted">
                  {formatTime(new Date(tip.timestamp).toISOString())}
                </span>
              </span>
              {switchingId === tip.eventId ? (
                <SpinIcon className="w-3 h-3 flex-shrink-0" />
              ) : (
                <span className="text-xs text-text-muted flex-shrink-0">{t({ en: 'Switch', fr: 'Basculer' })}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
