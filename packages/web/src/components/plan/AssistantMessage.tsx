import type { Message, MessageSegment } from '@openfox/shared'
import type { ChatStreamEvent } from '../../stores/session'
import { Markdown } from '../shared/Markdown'
import { ThinkingBlock } from '../shared/ThinkingBlock'
import { ToolCallDisplay } from '../shared/ToolCallDisplay'
import { StreamingCursor } from '../shared/StreamingCursor'

interface AssistantMessageProps {
  // Either streaming events OR a saved message
  events?: ChatStreamEvent[]
  message?: Message
  isStreaming?: boolean
  showStats?: boolean
}

// Convert a saved Message to events format for unified rendering
function messageToEvents(message: Message, showStats: boolean): ChatStreamEvent[] {
  // If message has segments, use them for accurate ordering
  if (message.segments && message.segments.length > 0) {
    const events = segmentsToEvents(message.segments, message.toolCalls ?? [])
    // Add stats at the end if present and showStats is true
    if (showStats && message.stats) {
      events.push({
        type: 'stats',
        model: message.stats.model,
        mode: message.stats.mode,
        totalTime: message.stats.totalTime,
        toolTime: message.stats.toolTime,
        prefillTokens: message.stats.prefillTokens,
        prefillSpeed: message.stats.prefillSpeed,
        generationTokens: message.stats.generationTokens,
        generationSpeed: message.stats.generationSpeed,
      })
    }
    return events
  }
  
  // Fallback for legacy messages without segments:
  // Approximate with thinking -> text -> tool calls
  const events: ChatStreamEvent[] = []
  
  if (message.thinkingContent) {
    events.push({ type: 'thinking', content: message.thinkingContent })
  }
  
  if (message.content) {
    events.push({ type: 'text', content: message.content })
  }
  
  if (message.toolCalls) {
    for (const tc of message.toolCalls) {
      events.push({ 
        type: 'tool_call', 
        callId: tc.id,
        tool: tc.name, 
        args: tc.arguments 
      })
      events.push({
        type: 'tool_result',
        callId: tc.id,
        tool: tc.name,
        result: { success: true, durationMs: 0, truncated: false }
      })
    }
  }
  
  // Add stats at the end if present and showStats is true
  if (showStats && message.stats) {
    events.push({
      type: 'stats',
      model: message.stats.model,
      mode: message.stats.mode,
      totalTime: message.stats.totalTime,
      toolTime: message.stats.toolTime,
      prefillTokens: message.stats.prefillTokens,
      prefillSpeed: message.stats.prefillSpeed,
      generationTokens: message.stats.generationTokens,
      generationSpeed: message.stats.generationSpeed,
    })
  }
  
  return events
}

// Convert stored segments to display events
function segmentsToEvents(
  segments: MessageSegment[],
  toolCalls: Message['toolCalls']
): ChatStreamEvent[] {
  const events: ChatStreamEvent[] = []
  const toolCallMap = new Map(toolCalls?.map(tc => [tc.id, tc]) ?? [])
  
  for (const segment of segments) {
    switch (segment.type) {
      case 'text':
        events.push({ type: 'text', content: segment.content })
        break
        
      case 'thinking':
        events.push({ type: 'thinking', content: segment.content })
        break
        
      case 'tool_call': {
        const tc = toolCallMap.get(segment.toolCallId)
        if (tc) {
          events.push({
            type: 'tool_call',
            callId: tc.id,
            tool: tc.name,
            args: tc.arguments,
          })
          events.push({
            type: 'tool_result',
            callId: tc.id,
            tool: tc.name,
            result: { success: true, durationMs: 0, truncated: false },
          })
        }
        break
      }
    }
  }
  
  return events
}

export function AssistantMessage({ events, message, isStreaming = false, showStats = true }: AssistantMessageProps) {
  // Convert message to events if provided
  const displayEvents = events ?? (message ? messageToEvents(message, showStats) : [])
  
  if (displayEvents.length === 0) return null
  
  // Group consecutive tool_call + tool_result pairs
  const renderedEvents: React.ReactNode[] = []
  let i = 0
  
  while (i < displayEvents.length) {
    const event = displayEvents[i]
    if (!event) { i++; continue }
    
    switch (event.type) {
      case 'thinking':
        renderedEvents.push(
          <ThinkingBlock key={i} content={event.content} />
        )
        break
        
      case 'text':
        renderedEvents.push(
          <div key={i} className="prose prose-invert max-w-none">
            <Markdown content={event.content} />
          </div>
        )
        break
        
      case 'tool_call': {
        // Check if next event is the result for this tool (match by callId)
        const nextEvent = displayEvents[i + 1]
        const hasResult = nextEvent?.type === 'tool_result' && nextEvent.callId === event.callId
        const toolResult = hasResult ? nextEvent.result : undefined
        
        renderedEvents.push(
          <ToolCallDisplay 
            key={i} 
            tool={event.tool} 
            args={event.args}
            status={hasResult ? (toolResult?.success ? 'success' : 'error') : 'pending'}
            variant="expandable"
            result={toolResult?.output}
            error={toolResult?.error}
            durationMs={toolResult?.durationMs}
          />
        )
        
        // Skip the result event since we handled it
        if (hasResult) i++
        break
      }
        
      case 'tool_result':
        // Standalone result (shouldn't happen normally, but handle it)
        renderedEvents.push(
          <ToolCallDisplay 
            key={i} 
            tool={event.tool} 
            args={{}}
            status={event.result.success ? 'success' : 'error'}
            variant="expandable"
            result={event.result.output}
            error={event.result.error}
            durationMs={event.result.durationMs}
          />
        )
        break
      
      case 'todo':
        // Todo updates displayed in chat
        renderedEvents.push(
          <div key={i} className="bg-bg-tertiary rounded-lg p-3 text-sm">
            <div className="font-medium text-text-secondary mb-2">Task List</div>
            <ul className="space-y-1">
              {event.todos.map((todo, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    todo.status === 'completed' ? 'bg-accent-success' :
                    todo.status === 'in_progress' ? 'bg-accent-warning' :
                    'bg-text-muted'
                  }`} />
                  <span className={todo.status === 'completed' ? 'text-text-muted line-through' : ''}>
                    {todo.content}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
        break
      
      case 'summary':
        // Summary block displayed prominently
        renderedEvents.push(
          <div key={i} className="bg-accent-primary/10 border border-accent-primary/30 rounded-lg p-4">
            <div className="font-medium text-accent-primary mb-2">Task Summary</div>
            <div className="text-text-primary">{event.summary}</div>
          </div>
        )
        break
      
      case 'progress':
        // Animated progress indicator
        renderedEvents.push(
          <div key={i} className="flex items-center gap-2 text-text-secondary text-sm py-2">
            <span className="inline-block w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            <span>{event.message}</span>
          </div>
        )
        break
      
      case 'format_retry':
        // Format retry indicator (model used XML instead of JSON)
        renderedEvents.push(
          <div key={i} className="flex items-center gap-2 text-amber-400 text-sm py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3">
            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Retrying (wrong format) - attempt {event.attempt}/{event.maxAttempts}</span>
          </div>
        )
        break
      
      case 'error':
        renderedEvents.push(
          <div key={i} className={`rounded-lg p-3 ${
            event.recoverable 
              ? 'bg-accent-warning/10 border border-accent-warning/30' 
              : 'bg-accent-error/10 border border-accent-error/30'
          }`}>
            <div className="text-sm">{event.error}</div>
          </div>
        )
        break
      
      case 'stats': {
        // Beautiful centered stats line with full metrics
        const shortModel = event.model.split('/').pop()?.split('-').slice(0, 2).join('-') ?? event.model
        const modeColor = event.mode === 'planner' ? 'text-purple-400' 
          : event.mode === 'builder' ? 'text-blue-400' 
          : 'text-green-400'
        const formatTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString()
        const formatSpeed = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0)
        
        // Fallbacks for old messages without new stats fields
        const totalTime = event.totalTime ?? 0
        const toolTime = event.toolTime ?? 0
        const prefillTokens = event.prefillTokens ?? 0
        const prefillSpeed = event.prefillSpeed ?? 0
        const generationTokens = event.generationTokens ?? 0
        const generationSpeed = event.generationSpeed ?? 0
        
        renderedEvents.push(
          <div key={i} className="flex items-center justify-center gap-2 text-xs text-text-muted mt-4">
            <span className="flex-1 h-px bg-border" />
            <span className="text-text-secondary">{shortModel}</span>
            <span className="text-text-muted">·</span>
            <span className={modeColor}>{event.mode}</span>
            <span className="text-text-muted">·</span>
            <span>{totalTime.toFixed(1)}s</span>
            {toolTime > 0 && (
              <>
                <span className="text-text-muted">·</span>
                <span>{toolTime.toFixed(1)}s tools</span>
              </>
            )}
            <span className="text-text-muted">·</span>
            <span>{formatTokens(prefillTokens)} @ {formatSpeed(prefillSpeed)} pp</span>
            <span className="text-text-muted">·</span>
            <span>{formatTokens(generationTokens)} @ {formatSpeed(generationSpeed)} tg</span>
            <span className="flex-1 h-px bg-border" />
          </div>
        )
        break
      }
    }
    
    i++
  }
  
  // Check if this is a partial (interrupted) message
  const isPartial = message?.partial === true
  
  return (
    <div className="mb-4 space-y-2">
      {renderedEvents}
      {isStreaming && <StreamingCursor />}
      {isPartial && (
        <div className="flex items-center gap-2 text-xs text-accent-warning mt-2">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Interrupted</span>
        </div>
      )}
    </div>
  )
}
