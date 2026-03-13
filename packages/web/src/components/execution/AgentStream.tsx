import { useRef, useEffect, useMemo } from 'react'
import type { AgentEvent } from '@openfox/shared/protocol'
import { ToolCall } from './ToolCall'
import { Markdown } from '../shared/Markdown'

interface AgentStreamProps {
  events: AgentEvent[]
}

// Grouped event for rendering - consecutive text/thinking are merged
type GroupedEvent =
  | { type: 'text'; content: string; isStreaming: boolean; key: number }
  | { type: 'thinking'; content: string; key: number }
  | { type: 'other'; event: AgentEvent; key: number }

export function AgentStream({ events }: AgentStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [events])
  
  // Group tool calls with their results
  const toolCallMap = useMemo(() => {
    const map = new Map<string, {
      call: Extract<AgentEvent, { type: 'tool_call' }>
      result?: Extract<AgentEvent, { type: 'tool_result' }>
      error?: Extract<AgentEvent, { type: 'tool_error' }>
    }>()
    
    for (const event of events) {
      if (event.type === 'tool_call') {
        map.set(event.callId, { call: event })
      } else if (event.type === 'tool_result') {
        const existing = map.get(event.callId)
        if (existing) {
          existing.result = event
        }
      } else if (event.type === 'tool_error') {
        const existing = map.get(event.callId)
        if (existing) {
          existing.error = event
        }
      }
    }
    return map
  }, [events])
  
  // Group consecutive text_delta and thinking events
  const groupedEvents = useMemo(() => {
    const groups: GroupedEvent[] = []
    let currentText = ''
    let currentThinking = ''
    let textStartIndex = -1
    let thinkingStartIndex = -1
    
    const flushText = (isStreaming: boolean) => {
      if (currentText) {
        groups.push({ type: 'text', content: currentText, isStreaming, key: textStartIndex })
        currentText = ''
        textStartIndex = -1
      }
    }
    
    const flushThinking = () => {
      if (currentThinking) {
        groups.push({ type: 'thinking', content: currentThinking, key: thinkingStartIndex })
        currentThinking = ''
        thinkingStartIndex = -1
      }
    }
    
    for (let i = 0; i < events.length; i++) {
      const event = events[i]!
      
      if (event.type === 'text_delta') {
        flushThinking()
        if (textStartIndex === -1) textStartIndex = i
        currentText += event.content
      } else if (event.type === 'thinking') {
        flushText(false)
        if (thinkingStartIndex === -1) thinkingStartIndex = i
        currentThinking += event.content
      } else {
        // Non-text event - flush accumulated text
        flushText(false)
        flushThinking()
        
        // Skip tool_result and tool_error (handled with tool_call)
        if (event.type !== 'tool_result' && event.type !== 'tool_error') {
          groups.push({ type: 'other', event, key: i })
        }
      }
    }
    
    // Flush remaining - last text block is streaming if not followed by done
    const lastEvent = events.at(-1)
    const isStillStreaming = lastEvent?.type === 'text_delta' || lastEvent?.type === 'thinking'
    flushText(isStillStreaming)
    flushThinking()
    
    return groups
  }, [events])
  
  return (
    <div ref={containerRef} className="h-full overflow-y-auto p-4">
      {events.length === 0 ? (
        <div className="text-text-muted text-center py-8">
          Agent will start executing...
        </div>
      ) : (
        <div className="space-y-2">
          {groupedEvents.map((group) => {
            if (group.type === 'text') {
              return (
                <div key={group.key} className="text-text-primary">
                  <Markdown content={group.content} />
                  {group.isStreaming && (
                    <span className="animate-pulse text-accent-primary">|</span>
                  )}
                </div>
              )
            }
            
            if (group.type === 'thinking') {
              return (
                <div key={group.key} className="text-text-muted text-sm italic">
                  <span className="text-purple-400">thinking:</span>
                  <div className="ml-2 mt-1">
                    <Markdown content={group.content} />
                  </div>
                </div>
              )
            }
            
            const event = group.event
            switch (event.type) {
              case 'tool_call': {
                const toolData = toolCallMap.get(event.callId)
                if (!toolData) return null
                return (
                  <ToolCall
                    key={group.key}
                    call={toolData.call}
                    result={toolData.result}
                    error={toolData.error}
                  />
                )
              }
              
              case 'criterion_update':
                return (
                  <div key={group.key} className="flex items-center gap-2 py-2">
                    <span className={
                      event.status.type === 'passed' ? 'text-accent-success' :
                      event.status.type === 'failed' ? 'text-accent-error' :
                      'text-accent-warning'
                    }>
                      {event.status.type === 'passed' ? '✓' : event.status.type === 'failed' ? '✗' : '●'}
                    </span>
                    <span className="text-sm">
                      Criterion {event.criterionId}: {event.status.type}
                    </span>
                  </div>
                )
              
              case 'context_compaction':
                return (
                  <div key={group.key} className="text-text-muted text-sm py-2 border-y border-border">
                    Context compacted: {event.beforeTokens.toLocaleString()} → {event.afterTokens.toLocaleString()} tokens
                  </div>
                )
              
              case 'stuck':
                return (
                  <div key={group.key} className="bg-accent-error/10 border border-accent-error rounded-lg p-3">
                    <div className="text-accent-error font-semibold">Agent Stuck</div>
                    <div className="text-text-secondary text-sm mt-1">{event.reason}</div>
                    <div className="text-text-muted text-xs mt-1">
                      Failed attempts: {event.failedAttempts}
                    </div>
                  </div>
                )
              
              case 'done':
                return (
                  <div key={group.key} className={`rounded-lg p-3 ${
                    event.allCriteriaPassed 
                      ? 'bg-accent-success/10 border border-accent-success'
                      : 'bg-accent-warning/10 border border-accent-warning'
                  }`}>
                    <div className={event.allCriteriaPassed ? 'text-accent-success' : 'text-accent-warning'}>
                      {event.allCriteriaPassed ? '✓ All Criteria Complete' : 'Execution Paused'}
                    </div>
                    <div className="text-text-secondary text-sm mt-1">{event.summary}</div>
                  </div>
                )
              
              case 'error':
                return (
                  <div key={group.key} className="bg-accent-error/10 border border-accent-error rounded-lg p-3">
                    <div className="text-accent-error">Error</div>
                    <div className="text-text-secondary text-sm">{event.error}</div>
                  </div>
                )
              
              case 'ask_user':
                return (
                  <div key={group.key} className="bg-accent-primary/10 border border-accent-primary rounded-lg p-3">
                    <div className="text-accent-primary font-semibold">Question</div>
                    <div className="text-text-primary mt-1">{event.question}</div>
                  </div>
                )
              
              default:
                return null
            }
          })}
        </div>
      )}
    </div>
  )
}
