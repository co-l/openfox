import { useLocation } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { InfoIcon } from './icons'

interface CrossSessionConfirmationBannerProps {
  projectId?: string
}

export function CrossSessionConfirmationBanner({ projectId }: CrossSessionConfirmationBannerProps) {
  const [, navigate] = useLocation()
  const sessionsWithPending = useSessionStore((state) => state.sessionsWithPendingConfirmations)
  const currentSessionId = useSessionStore((state) => state.currentSession?.id)
  const crossSessionConfirmations = useSessionStore((state) => state.crossSessionConfirmations)
  const sessions = useSessionStore((state) => state.sessions)

  // Only show for background sessions with pending confirmations
  const targetSessionId = sessionsWithPending.find((sid) => sid !== currentSessionId)
  if (!targetSessionId) return null

  const targetSession = sessions.find((s) => s.id === targetSessionId)
  const title = targetSession?.title ?? targetSessionId.slice(0, 6)
  const pendingCount = crossSessionConfirmations[targetSessionId]?.length ?? 0

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 cursor-pointer hover:bg-amber-500/20 transition-colors"
      onClick={() => navigate(projectId ? `/p/${projectId}/s/${targetSessionId}` : `/s/${targetSessionId}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          navigate(projectId ? `/p/${projectId}/s/${targetSessionId}` : `/s/${targetSessionId}`)
        }
      }}
    >
      <InfoIcon className="w-4 h-4 text-amber-400 flex-shrink-0" />
      <span className="text-sm text-amber-300 flex-1 truncate">
        {pendingCount} confirmation{pendingCount > 1 ? 's' : ''} pending in session &quot;{title}&quot;
      </span>
      <span className="text-xs text-amber-400 font-medium flex-shrink-0">View session →</span>
    </div>
  )
}
