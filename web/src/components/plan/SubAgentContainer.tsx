import { memo, useRef, useEffect, useState, useCallback } from 'react'
import type { Message, ContextState } from '@shared/types.js'
import { AssistantMessage } from './AssistantMessage'
import { ChatMessage } from './ChatMessage'
import { useAgentsStore, getAgentColor } from '../../stores/agents'
import { useSessionStore } from '../../stores/session'
import { formatTokens } from '../../lib/format-stats'

interface SubAgentContainerProps {
  messages: Message[]
  subAgentType: string
  subAgentId: string
  isStreaming: boolean
}

const LABELS: Record<string, string> = {
  verifier: 'Verification',
  code_reviewer: 'Code Review',
  test_generator: 'Test Generation',
  debugger: 'Debug',
}

function headerStyle(hex: string) {
  return {
    backgroundColor: `${hex}20`,
    color: hex,
    borderColor: `${hex}4d`,
  }
}

function getProgressColor(percent: number, dangerZone: boolean): string {
  if (dangerZone) return 'bg-accent-error'
  if (percent > 85) return 'bg-accent-error'
  if (percent > 60) return 'bg-accent-warning'
  return 'bg-accent-success'
}

function getTextColor(percent: number, dangerZone: boolean): string {
  if (dangerZone) return 'text-accent-error'
  if (percent > 85) return 'text-accent-error'
  if (percent > 60) return 'text-accent-warning'
  return 'text-text-muted'
}

function SubAgentContextBar({ contextState }: { contextState: ContextState }) {
  const { currentTokens, maxTokens, compactionCount, dangerZone } = contextState
  const percent = Math.round((currentTokens / maxTokens) * 100)

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className={getTextColor(percent, dangerZone)}>
        {formatTokens(currentTokens)}/{formatTokens(maxTokens)}
      </span>
      <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden w-12">
        <div
          className={`h-full transition-all duration-300 ${getProgressColor(percent, dangerZone)}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {dangerZone && (
        <span className="text-accent-error animate-pulse">Low!</span>
      )}
      {compactionCount > 0 && (
        <span className="text-text-muted bg-bg-tertiary px-1 rounded">
          {compactionCount}x
        </span>
      )}
    </div>
  )
}

export const SubAgentContainer = memo(function SubAgentContainer({ messages, subAgentType, subAgentId, isStreaming }: SubAgentContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const agents = useAgentsStore(state => state.agents)
  const contextState = useSessionStore(state => state.subAgentContextStates[subAgentId])

  const handleToggleExpand = useCallback(() => {
    const willExpand = !expanded
    setExpanded(willExpand)

    if (willExpand) {
      setTimeout(() => {
        containerRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }, 220)
    }
  }, [expanded])

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const container = scrollContainerRef.current
    if (!container) return

    if (e.deltaY < 0) {
      setUserScrolledUp(true)
    } else if (e.deltaY > 0 && userScrolledUp) {
      requestAnimationFrame(() => {
        const threshold = 50
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
        if (distanceFromBottom < threshold) {
          setUserScrolledUp(false)
        }
      })
    }
  }, [userScrolledUp])

  useEffect(() => {
    if (!userScrolledUp) {
      scrollToBottom()
    }
  }, [messages, userScrolledUp, scrollToBottom])

  useEffect(() => {
    if (!isStreaming) {
      setUserScrolledUp(false)
    }
  }, [isStreaming])

  const agentInfo = agents.find(a => a.id === subAgentType)
  const label = agentInfo?.name ?? LABELS[subAgentType] ?? subAgentType
  const color = getAgentColor(agents, subAgentType)
  const hStyle = headerStyle(color)

  const displayMessages = messages.filter(m => m.role !== 'tool')

  return (
    <div ref={containerRef} className="feed-item border border-border rounded overflow-hidden bg-bg-secondary">
      <button
        className="w-full flex items-center justify-between px-2 py-1 text-xs font-medium border-b hover:opacity-80 transition-opacity"
        style={hStyle}
        onClick={handleToggleExpand}
      >
        <span>{label}</span>
        <div className="flex items-center gap-2">
          {contextState && <SubAgentContextBar contextState={contextState} />}
          <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
        </div>
      </button>

      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className={`${expanded ? 'max-h-[calc(100vh-10rem)]' : 'max-h-80'} overflow-y-auto p-2 transition-[max-height] duration-200`}
      >
        {displayMessages.map((message) => {
          if (message.role === 'assistant') {
            return (
              <AssistantMessage
                key={message.id}
                message={message}
                showStats={true}
              />
            )
          }

          return (
            <ChatMessage
              key={message.id}
              message={message}
              isLastAssistantMessage={false}
            />
          )
        })}
      </div>
    </div>
  )
})