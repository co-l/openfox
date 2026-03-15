import type { Message, MessageSegment, ToolCall } from '@openfox/shared'
import { Markdown } from '../shared/Markdown'
import { ThinkingBlock } from '../shared/ThinkingBlock'
import { ToolCallDisplay } from '../shared/ToolCallDisplay'
import { StreamingCursor } from '../shared/StreamingCursor'

interface AssistantMessageProps {
  message: Message
  isStreaming?: boolean
  showStats?: boolean
}

// Display element types for rendering
type DisplayElement = 
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'stats'; stats: NonNullable<Message['stats']> }

// Convert message to display elements in correct order
function messageToElements(message: Message, showStats: boolean): DisplayElement[] {
  // If message has segments, use them for accurate ordering
  if (message.segments && message.segments.length > 0) {
    return segmentsToElements(message.segments, message.toolCalls ?? [], message.stats, showStats)
  }
  
  // Fallback for messages without segments (legacy or streaming)
  const elements: DisplayElement[] = []
  
  if (message.thinkingContent) {
    elements.push({ type: 'thinking', content: message.thinkingContent })
  }
  
  if (message.content) {
    elements.push({ type: 'text', content: message.content })
  }
  
  if (message.toolCalls) {
    for (const tc of message.toolCalls) {
      elements.push({ type: 'tool_call', toolCall: tc })
    }
  }
  
  if (showStats && message.stats) {
    elements.push({ type: 'stats', stats: message.stats })
  }
  
  return elements
}

// Convert stored segments to display elements
function segmentsToElements(
  segments: MessageSegment[],
  toolCalls: ToolCall[],
  stats: Message['stats'],
  showStats: boolean
): DisplayElement[] {
  const elements: DisplayElement[] = []
  const toolCallMap = new Map(toolCalls.map(tc => [tc.id, tc]))
  
  for (const segment of segments) {
    switch (segment.type) {
      case 'text':
        elements.push({ type: 'text', content: segment.content })
        break
        
      case 'thinking':
        elements.push({ type: 'thinking', content: segment.content })
        break
        
      case 'tool_call': {
        const tc = toolCallMap.get(segment.toolCallId)
        if (tc) {
          elements.push({ type: 'tool_call', toolCall: tc })
        }
        break
      }
    }
  }
  
  if (showStats && stats) {
    elements.push({ type: 'stats', stats })
  }
  
  return elements
}

export function AssistantMessage({ message, isStreaming = false, showStats = true }: AssistantMessageProps) {
  const elements = messageToElements(message, showStats)
  
  if (elements.length === 0 && !isStreaming) return null
  
  return (
    <div className="mb-2 space-y-1">
      {elements.map((element, i) => {
        switch (element.type) {
          case 'thinking':
            return <ThinkingBlock key={i} content={element.content} />
            
          case 'text':
            return (
              <div key={i} className="prose prose-sm prose-invert max-w-none">
                <Markdown content={element.content} />
              </div>
            )
            
          case 'tool_call': {
            const tc = element.toolCall
            const result = tc.result
            return (
              <ToolCallDisplay 
                key={i} 
                tool={tc.name} 
                args={tc.arguments}
                status={result ? (result.success ? 'success' : 'error') : 'pending'}
                variant="expandable"
                result={result?.output}
                error={result?.error}
                durationMs={result?.durationMs}
              />
            )
          }
            
          case 'stats': {
            const stats = element.stats
            const shortModel = stats.model.split('/').pop()?.split('-').slice(0, 2).join('-') ?? stats.model
            const modeColor = stats.mode === 'planner' ? 'text-purple-400' 
              : stats.mode === 'builder' ? 'text-blue-400' 
              : 'text-green-400'
            const formatTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString()
            const formatSpeed = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(1)
            
            return (
              <div key={i} className="flex items-center justify-center gap-1.5 text-[10px] text-text-muted mt-2">
                <span className="flex-1 h-px bg-border" />
                <span className="text-text-secondary">{shortModel}</span>
                <span className="text-text-muted">·</span>
                <span className={modeColor}>{stats.mode}</span>
                <span className="text-text-muted">·</span>
                <span>{stats.totalTime.toFixed(1)}s</span>
                {stats.toolTime > 0 && (
                  <>
                    <span className="text-text-muted">·</span>
                    <span>{stats.toolTime.toFixed(1)}s tools</span>
                  </>
                )}
                <span className="text-text-muted">·</span>
                <span>{formatTokens(stats.prefillTokens)} @ {formatSpeed(stats.prefillSpeed)} pp</span>
                <span className="text-text-muted">·</span>
                <span>{formatTokens(stats.generationTokens)} @ {formatSpeed(stats.generationSpeed)} tg</span>
                <span className="flex-1 h-px bg-border" />
              </div>
            )
          }
        }
      })}
      
        {isStreaming && <StreamingCursor />}
        
        {message.partial && (
          <div className="flex items-center gap-1.5 text-[10px] text-accent-warning mt-1">
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Interrupted</span>
          </div>
        )}
    </div>
  )
}
