import { memo, useRef, useState, useCallback } from 'react'
import type { Message, ContextState } from '@shared/types.js'
import { AssistantMessage } from './AssistantMessage'
import { ChatMessage } from './ChatMessage'
import { useT } from '../../hooks/useT'
import { useAgents } from '../../hooks/useAgents'
import { useConfig } from '../../hooks/useConfig'
import { getAgentColor } from '../../lib/agents-actions'
import { resolveSubAgentModelLabel } from '../../lib/model-value'
import { useSessionStore } from '../../stores/session'
import { useScopedContext } from '../../stores/session/session-scope'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'
import { formatTokens } from '../../lib/format-stats'
import { useAutoScroll } from '../../hooks/useAutoScroll'
import { useViewport } from '../../hooks/useViewport'
import { ScrollArea } from '../shared/ScrollArea'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import { ProgressBar } from '../shared/ProgressBar'

interface SubAgentContainerProps {
  messages: Message[]
  subAgentType: string
  subAgentId: string
  isStreaming: boolean
}

const LABELS: Record<string, { en: string; fr: string }> = {
  verifier: { en: 'Verification', fr: 'Vérification' },
  code_reviewer: { en: 'Code Review', fr: 'Revue de code' },
  test_generator: { en: 'Test Generation', fr: 'Génération de tests' },
  debugger: { en: 'Debug', fr: 'Débogage' },
}

function headerStyle(hex: string) {
  return {
    backgroundColor: `${hex}20`,
    color: hex,
    borderColor: `${hex}4d`,
  }
}

function getTextColor(percent: number, dangerZone: boolean): string {
  if (dangerZone) return 'text-accent-error'
  if (percent > 85) return 'text-accent-error'
  if (percent > 60) return 'text-accent-warning'
  return 'text-text-muted'
}

function SubAgentContextBar({ contextState }: { contextState: ContextState }) {
  const t = useT()
  const { currentTokens, maxTokens, compactionCount, dangerZone } = contextState
  const percent = Math.round((currentTokens / maxTokens) * 100)

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className={getTextColor(percent, dangerZone)}>
        {formatTokens(currentTokens)}/{formatTokens(maxTokens)}
      </span>
      <span className={getTextColor(percent, dangerZone)}>{`(${percent}%)`}</span>
      <ProgressBar percent={percent} dangerZone={dangerZone} size="sm" />
      {dangerZone && <span className="text-accent-error animate-pulse">{t({ en: 'Low!', fr: 'Faible !' })}</span>}
      {compactionCount > 0 && (
        <span className="text-text-muted bg-bg-tertiary px-1 rounded">{`${compactionCount}x`}</span>
      )}
    </div>
  )
}

export const SubAgentContainer = memo(function SubAgentContainer({
  messages,
  subAgentType,
  subAgentId,
  isStreaming: _isStreaming,
}: SubAgentContainerProps) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<OverlayScrollbarsComponentRef<'div'>>(null)
  const [expanded, setExpanded] = useState(false)
  const { currentSession } = useScopedContext()
  const { agents, modelOverrides } = useAgents(currentSession?.workdir)
  const { config } = useConfig()
  const contextState = useSessionStore((state) => state.subAgentContextStates[subAgentId])
  const { showThinking, showVerboseToolOutput } = useDisplaySettings()

  const getViewport = useViewport(scrollRef)

  const { isAutoScrollActive, setAutoScroll, handleScrollbarGesture } = useAutoScroll(scrollRef, null, getViewport)

  const agentInfo = agents.find((a) => a.id === subAgentType)
  const label = agentInfo?.name ?? (LABELS[subAgentType] ? t(LABELS[subAgentType]) : subAgentType)
  const color = getAgentColor(agents, subAgentType)
  const hStyle = headerStyle(color)

  const modelLabel = resolveSubAgentModelLabel({
    messages,
    subAgentType,
    modelOverrides,
    sessionProviderModel: currentSession?.providerModel,
    sessionReasoningEffort: currentSession?.providerReasoningEffort,
    defaultModelSelection: config?.defaultModelSelection,
  })

  const handleToggleExpand = useCallback(() => {
    const willExpand = !expanded
    setExpanded(willExpand)

    if (willExpand) {
      setTimeout(() => {
        containerRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }, 220)
    }
  }, [expanded])

  const displayMessages = messages.filter((m) => m.role !== 'tool')

  return (
    <div ref={containerRef} className="feed-item border border-border rounded overflow-hidden bg-secondary">
      <div
        data-testid="subagent-header"
        className="w-full flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 py-1 border-b"
        style={hStyle}
      >
        <div className="order-1 flex items-center gap-2 min-w-0 flex-1 basis-0 @sm:basis-auto @sm:flex-none">
          <span className="text-xs font-medium truncate">{label}</span>
          {modelLabel && (
            <span
              data-testid="subagent-model-badge"
              className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary font-mono truncate"
            >
              {modelLabel}
            </span>
          )}
        </div>
        {contextState && (
          <div
            data-testid="subagent-context-bar-slot"
            className="order-3 w-full flex justify-center @sm:order-2 @sm:w-auto @sm:flex-1 @sm:min-w-0"
          >
            <SubAgentContextBar contextState={contextState} />
          </div>
        )}
        <div className="order-2 flex items-center gap-2 shrink-0 @sm:order-3">
          <button
            type="button"
            className="text-sm text-text-muted hover:text-text-primary flex items-center gap-1.5"
            onClick={() => setAutoScroll(!isAutoScrollActive)}
          >
            <span
              className={`w-1 h-1 rounded-full ${isAutoScrollActive ? 'bg-accent-success' : 'border border-text-muted'}`}
            />
            {t({ en: 'live', fr: 'direct' })}
          </button>
          <button
            type="button"
            className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary"
            onClick={handleToggleExpand}
          >
            {expanded ? '▼' : '▶'} {t({ en: 'Expand', fr: 'Développer' })}
          </button>
        </div>
      </div>

      <ScrollArea
        ref={scrollRef}
        className={`${expanded ? 'max-h-[calc(100vh-10rem)]' : 'max-h-80'} p-2 transition-[max-height] duration-200`}
        onScrollbarGesture={handleScrollbarGesture}
      >
        {displayMessages.map((message) => {
          if (message.role === 'assistant') {
            return (
              <AssistantMessage
                key={message.id}
                message={message}
                showStats={true}
                showThinking={showThinking}
                showVerboseToolOutput={showVerboseToolOutput}
              />
            )
          }

          return <ChatMessage key={message.id} message={message} isLastAssistantMessage={false} />
        })}
      </ScrollArea>
    </div>
  )
})
