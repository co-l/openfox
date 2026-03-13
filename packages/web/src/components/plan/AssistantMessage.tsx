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
}

// Convert a saved Message to events format for unified rendering
function messageToEvents(message: Message): ChatStreamEvent[] {
  // If message has segments, use them for accurate ordering
  if (message.segments && message.segments.length > 0) {
    return segmentsToEvents(message.segments, message.toolCalls ?? [])
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

export function AssistantMessage({ events, message, isStreaming = false }: AssistantMessageProps) {
  // Convert message to events if provided
  const displayEvents = events ?? (message ? messageToEvents(message) : [])
  
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
        
        renderedEvents.push(
          <ToolCallDisplay 
            key={i} 
            tool={event.tool} 
            args={event.args}
            status={hasResult ? 'success' : 'pending'}
            variant="compact"
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
            status="success"
            variant="compact"
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
    }
    
    i++
  }
  
  return (
    <div className="mb-4 space-y-2">
      {renderedEvents}
      {isStreaming && <StreamingCursor />}
    </div>
  )
}
