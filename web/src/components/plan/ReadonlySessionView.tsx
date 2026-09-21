import { ScrollArea } from '../shared/ScrollArea'
import { useState, useEffect, useMemo } from 'react'
import { useRoute } from 'wouter'
import { useT } from '../../hooks/useT'
import { readonlySessionResource } from '../../lib/resources'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'
import { groupMessages, type DisplayItem } from './groupMessages.js'
import { ChatFeedItems } from './ChatFeedItems'
import { Spinner } from '../shared/Spinner'
import type { Session, Message } from '@shared/types.js'

export function ReadonlySessionView() {
  const t = useT()
  const [, params] = useRoute('/p/:projectId/s/:sessionId/readonly')
  const sessionId = params?.sessionId

  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [hiddenCount, setHiddenCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSession = async () => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      const data = await readonlySessionResource.refresh(sessionId)
      setSession(data?.session ?? null)
      setMessages(data?.messages ?? [])
      setHiddenCount(data?.hiddenCount ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : t({ en: 'Unknown error', fr: 'Erreur inconnue' }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSession()
  }, [sessionId])

  const { showThinking, showVerboseToolOutput, showStats, showAgentDefinitions, showWorkflowBars } =
    useDisplaySettings()

  const displayItems = useMemo((): DisplayItem[] => {
    return groupMessages(messages)
  }, [messages])

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-primary">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-primary">
        <div className="text-center space-y-4">
          <div className="text-red-400 text-sm">{error}</div>
          <button
            onClick={loadSession}
            className="px-3 py-1.5 text-sm bg-bg-tertiary text-text-primary border border-border rounded hover:bg-bg-tertiary/80 transition-colors"
          >
            {t({ en: 'Retry', fr: 'Réessayer' })}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen print:h-auto flex flex-col bg-primary">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-secondary shrink-0 print:hidden">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-sm font-medium text-text-primary truncate">
            {session?.metadata?.title ?? t({ en: 'Session', fr: 'Session' })} —{' '}
            {t({ en: 'Read-only view', fr: 'Vue en lecture seule' })}
          </h1>
          <span className="text-xs text-text-muted whitespace-nowrap">
            {t({ en: '{{count}} messages', fr: '{{count}} messages' }, { count: messages.length })}
            {hiddenCount > 0
              ? ` (${t({ en: '{{count}} older hidden', fr: '{{count}} plus anciens masqués' }, { count: hiddenCount })})`
              : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadSession}
            disabled={loading}
            className="px-3 py-1 text-xs bg-bg-tertiary text-text-primary border border-border rounded hover:bg-bg-tertiary/80 transition-colors disabled:opacity-50"
          >
            {loading ? t({ en: 'Refreshing...', fr: 'Actualisation…' }) : t({ en: 'Refresh', fr: 'Actualiser' })}
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1 print:overflow-visible">
        <div className="pt-4">
          <ChatFeedItems
            displayItems={displayItems}
            showThinking={showThinking}
            showVerboseToolOutput={showVerboseToolOutput}
            showStats={showStats}
            showAgentDefinitions={showAgentDefinitions}
            showWorkflowBars={showWorkflowBars}
          />
        </div>
        <div className="h-8" />
      </ScrollArea>
    </div>
  )
}
