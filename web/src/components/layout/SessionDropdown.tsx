import { useMemo } from 'react'
import { useSessionStore } from '../../stores/session'
import { useT } from '../../hooks/useT'
import { DropdownMenu, type DropdownMenuItem } from '../shared/DropdownMenu'
import { ChevronDownIcon, PlusIcon, CheckIcon, StarIcon, StarFilledIcon } from '../shared/icons'
import { groupSessionsByDate, formatDateHeader, formatTime } from '../../lib/format-date'
import { trimContent } from '../../lib/cross-session-history'
import type { SessionSummary } from '@shared/types.js'

interface SessionDropdownProps {
  sessions: SessionSummary[]
  currentProject: { id: string; name: string; workdir: string }
  currentSession: { id: string; metadata?: { title?: string } } | null
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SessionDropdown({
  sessions,
  currentProject,
  currentSession,
  isOpen,
  onOpenChange,
}: SessionDropdownProps) {
  const t = useT()
  const loadSession = useSessionStore((state) => state.loadSession)
  const toggleFavorite = useSessionStore((state) => state.toggleFavorite)
  const MAX_TITLE_LEN = 50

  const projectSessions = sessions.filter((session) => session.projectId === currentProject.id).slice(0, 15)
  const favoriteSessions = projectSessions.filter((s) => s.isFavorite)
  const otherSessions = projectSessions.filter((s) => !s.isFavorite)

  const items: DropdownMenuItem[] = useMemo(() => {
    const result: DropdownMenuItem[] = []

    result.push({
      label: (
        <div className="flex items-center gap-2">
          <PlusIcon className="w-4 h-4 text-accent-primary" />
          <span className="text-sm">{t({ en: 'New session', fr: 'Nouvelle session' })}</span>
        </div>
      ),
      href: `/p/${currentProject.id}/new`,
      onClick: () => {},
    })

    const buildSessionItem = (session: SessionSummary, showTime: boolean) => {
      result.push({
        label: (
          <div className="min-w-[160px]">
            <div className="truncate text-sm">
              {trimContent(session.title ?? session.id.slice(0, 8), MAX_TITLE_LEN)}
            </div>
            {showTime && <div className="text-text-muted text-xs">{formatTime(session.updatedAt)}</div>}
          </div>
        ),
        icon: session.id === currentSession?.id ? <CheckIcon /> : undefined,
        href: `/p/${currentProject.id}/s/${session.id}`,
        onClick: () => {
          loadSession(session.id)
        },
        labelAction: (
          <button
            onClick={() => toggleFavorite(session.id, !session.isFavorite)}
            className="flex-shrink-0 p-1 hover:bg-bg-tertiary rounded transition-colors"
            title={
              session.isFavorite
                ? t({ en: 'Unfavorite session', fr: 'Retirer des favoris' })
                : t({ en: 'Favorite session', fr: 'Ajouter aux favoris' })
            }
          >
            {session.isFavorite ? (
              <StarFilledIcon className="w-3.5 h-3.5 text-yellow-500" />
            ) : (
              <StarIcon className="w-3.5 h-3.5 text-text-muted hover:text-yellow-500" />
            )}
          </button>
        ),
      })
    }

    const buildGroup = (groupSessions: SessionSummary[]) => {
      const grouped = groupSessionsByDate(groupSessions)
      for (const [_dateKey, daySessions] of grouped) {
        const firstSession = daySessions[0]
        if (!firstSession) continue

        result.push({
          label: (
            <div className="px-3 py-2 text-text-muted text-xs font-medium cursor-default">
              {formatDateHeader(firstSession.updatedAt)}
            </div>
          ),
          onClick: () => {},
        })

        for (const session of daySessions) {
          buildSessionItem(session, true)
        }
      }
    }

    if (favoriteSessions.length > 0) {
      for (const session of favoriteSessions) {
        buildSessionItem(session, false)
      }
    }
    buildGroup(otherSessions)

    return result
  }, [currentProject.id, favoriteSessions, otherSessions, currentSession?.id, t])

  const rawTitle = currentSession?.metadata?.title ?? (currentSession ? currentSession.id.slice(0, 8) : null)
  const triggerLabel = rawTitle
    ? trimContent(rawTitle, MAX_TITLE_LEN)
    : t({ en: 'No session selected', fr: 'Aucune session sélectionnée' })

  return (
    <DropdownMenu
      items={items}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      trigger={
        <button
          className="text-text-secondary hover:text-text-primary hover:underline text-sm w-full min-w-0 flex items-center gap-1"
          title={rawTitle ?? ''}
          data-testid="header-session-dropdown"
        >
          <span className="truncate min-w-[3ch]">{triggerLabel}</span>
          <ChevronDownIcon className="w-3 h-3 flex-shrink-0" />
        </button>
      }
      minWidth="280px"
      labelActionClassName="pr-3"
    />
  )
}
