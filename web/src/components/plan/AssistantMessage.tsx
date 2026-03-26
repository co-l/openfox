import { memo } from 'react'
// @ts-ignore
import type { Message, MessageSegment, ToolCall, PreparingToolCall } from '@shared/types.js'
import { Markdown } from '../shared/Markdown'
import { ThinkingBlock } from '../shared/ThinkingBlock'
import { ToolCallDisplay } from '../shared/ToolCallDisplay'
import { ToolCallPreparing } from '../shared/ToolCallPreparing'
import { TodoListDisplay } from '../shared/TodoListDisplay'
import { CriteriaGroupDisplay, isCriterionTool } from '../shared/CriteriaGroupDisplay'
import { useSessionStore } from '../../stores/session'
import { useAgentsStore, getAgentColor } from '../../stores/agents'

interface AssistantMessageProps {
  message: Message
  showStats?: boolean
}

// Display element types for rendering
type DisplayElement = 
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }
  | { type: 'preparing_tool_call'; preparing: PreparingToolCall }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'criteria_group'; toolCalls: ToolCall[] }
  | { type: 'stats'; stats: NonNullable<Message['stats']> }

// Group consecutive criterion tool calls into a single criteria_group element
function groupConsecutiveCriteria(elements: DisplayElement[]): DisplayElement[] {
  const result: DisplayElement[] = []
  let criteriaBuffer: ToolCall[] = []
  
  const flushBuffer = () => {
    if (criteriaBuffer.length > 0) {
      result.push({ type: 'criteria_group', toolCalls: criteriaBuffer })
      criteriaBuffer = []
    }
  }
  
  for (const element of elements) {
    if (element.type === 'tool_call' && isCriterionTool(element.toolCall.name)) {
      criteriaBuffer.push(element.toolCall)
    } else {
      flushBuffer()
      result.push(element)
    }
  }
  
  flushBuffer()
  return result
}

// Convert message to display elements in correct order
function messageToElements(message: Message, showStats: boolean): DisplayElement[] {
  // If message has segments, use them for accurate ordering
  if (message.segments && message.segments.length > 0) {
    return segmentsToElements(message.segments, message.toolCalls ?? [], message.preparingToolCalls ?? [], message.stats, showStats)
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
  
  // Add preparing tool calls (temporary, shown while streaming)
  if (message.preparingToolCalls) {
    for (const ptc of message.preparingToolCalls) {
      elements.push({ type: 'preparing_tool_call', preparing: ptc })
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
  preparingToolCalls: PreparingToolCall[],
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
        if (segment.content && segment.content.trim().length > 0) {
          elements.push({ type: 'thinking', content: segment.content })
        }
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
  
  // Add preparing tool calls at the end (during streaming)
  for (const ptc of preparingToolCalls) {
    elements.push({ type: 'preparing_tool_call', preparing: ptc })
  }
  
  if (showStats && stats) {
    elements.push({ type: 'stats', stats })
  }
  
  return elements
}

export const AssistantMessage = memo(function AssistantMessage({ message, showStats = true }: AssistantMessageProps) {
  const criteria = useSessionStore(state => state.currentSession?.criteria)
  const agents = useAgentsStore(state => state.agents)
  const rawElements = messageToElements(message, showStats)
  const elements = groupConsecutiveCriteria(rawElements)
  
  if (elements.length === 0) return null
  
  return (
    <div className="feed-item">
      <div className="min-w-0">
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
          
          case 'preparing_tool_call':
            return <ToolCallPreparing key={`preparing-${element.preparing.index}`} name={element.preparing.name} />
            
          case 'tool_call': {
            const tc = element.toolCall
            const result = tc.result
            
            // Special: todo_write → inline todo list
            if (tc.name === 'todo_write') {
              const todosArg = tc.arguments['todos']
              // Defensive: ensure todos is an array (handle malformed LLM output)
              const todos = Array.isArray(todosArg) ? todosArg : []
              return <TodoListDisplay key={i} todos={todos} />
            }
            
            // Determine status - check for interrupted marker in output
            const isInterrupted = result?.output?.includes('[interrupted by user]')
            const status = result 
              ? (isInterrupted ? 'interrupted' : (result.success ? 'success' : 'error'))
              : 'pending'
            
            // Default: standard tool call display
            return (
              <ToolCallDisplay 
                key={i} 
                tool={tc.name} 
                args={tc.arguments}
                status={status}
                variant="expandable"
                result={result?.output}
                error={result?.error}
                durationMs={result?.durationMs}
                diagnostics={result?.diagnostics}
                editContext={result?.editContext}
                startedAt={tc.startedAt}
                streamingOutput={tc.streamingOutput}
                metadata={result?.metadata}
              />
            )
          }
          
          case 'criteria_group':
            return <CriteriaGroupDisplay key={i} toolCalls={element.toolCalls} criteria={criteria} />
            
          case 'stats': {
            const stats = element.stats
            const shortModel = stats.model.split('/').pop()?.split('-').slice(0, 2).join('-') ?? stats.model
            const modeColor = getAgentColor(agents, stats.mode)
            const formatTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString()
            const formatSpeed = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(1)
            
            return (
              <div key={i} className="flex items-center justify-center gap-1.5 text-[10px] text-text-muted mt-3">
                <span className="flex-1 h-px bg-border" />
                <span className="text-text-secondary">{shortModel}</span>
                <span className="text-text-muted">·</span>
                <span style={{ color: modeColor }}>{stats.mode}</span>
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
        
        {message.partial && (
          <div className="flex items-center gap-1.5 text-[10px] text-accent-warning mt-1">
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Aborted</span>
          </div>
        )}
      </div>
    </div>
  )
})
