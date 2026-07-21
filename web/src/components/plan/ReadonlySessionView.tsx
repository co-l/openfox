import { useState, useEffect, useMemo } from 'react'
import { useRoute } from 'wouter'
import { authFetch } from '../../lib/api'
import { useDisplaySettings, useSettingsStore, DISPLAY_SETTINGS_KEYS } from '../../stores/settings'
import { groupMessages, type DisplayItem } from './groupMessages.js'
import { ChatFeedItems } from './ChatFeedItems'
import { Spinner } from '../shared/Spinner'
import type { Session, Message } from '@shared/types.js'

export function ReadonlySessionView() {
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
      const res = await authFetch(`/api/sessions/${sessionId}?full=true`)
      if (!res.ok) {
        setError(`Failed to load session (${res.status})`)
        setLoading(false)
        return
      }
      const data = await res.json()
      setSession(data.session ?? null)
      setMessages((data.messages as Message[]) ?? [])
      setHiddenCount((data.hiddenCount as number) ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    useSettingsStore.getState().getSettings([...DISPLAY_SETTINGS_KEYS])
  }, [])

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
            Retry
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
            {session?.metadata?.title ?? 'Session'} — Read-only view
          </h1>
          <span className="text-xs text-text-muted whitespace-nowrap">
            {messages.length} messages{hiddenCount > 0 ? ` (${hiddenCount} older hidden)` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadSession}
            disabled={loading}
            className="px-3 py-1 text-xs bg-bg-tertiary text-text-primary border border-border rounded hover:bg-bg-tertiary/80 transition-colors disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto print:overflow-visible scrollbar-stable">
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
      </div>
    </div>
  )
}
