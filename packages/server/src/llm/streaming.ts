import type { MessageSegment, ToolCall } from '@openfox/shared'
import type { LLMClient, LLMCompletionRequest, LLMStreamEvent, LLMCompletionResponse } from './types.js'

// XML patterns that indicate wrong tool format (model outputting XML instead of JSON function calls)
const XML_TOOL_PATTERNS = ['<tool_call>', '<function=', '</tool_call>', '<parameter=']

function hasXmlToolPattern(text: string): boolean {
  return XML_TOOL_PATTERNS.some(p => text.includes(p))
}

/**
 * Streaming event with segment tracking.
 * Same as LLMStreamEvent but adds segment context.
 */
export type StreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'done'; response: LLMCompletionResponse }
  | { type: 'error'; error: string }
  | { type: 'xml_tool_abort' }

/**
 * Timing metrics for a streaming LLM call.
 */
export interface StreamTiming {
  ttft: number           // time to first token (seconds)
  completionTime: number // generation time (seconds)
  tps: number            // tokens per second (generation)
  prefillTps: number     // prompt tokens / ttft
}

/**
 * Result from a single streaming LLM call.
 * Contains accumulated content and segments for that call.
 */
export interface StreamResult {
  content: string
  thinkingContent: string
  toolCalls: ToolCall[]
  response: LLMCompletionResponse
  segments: MessageSegment[]
  timing: StreamTiming
}

/**
 * Streams an LLM completion and accumulates content with segment tracking.
 * Yields events for real-time streaming, returns accumulated result.
 * 
 * Merges consecutive text/thinking deltas into single segments.
 */
export async function* streamWithSegments(
  client: LLMClient,
  request: LLMCompletionRequest
): AsyncGenerator<StreamEvent, StreamResult | null> {
  // Create internal abort controller for XML detection
  const xmlAbortController = new AbortController()
  
  // Combine with any external signal (e.g., user abort)
  const combinedSignal = request.signal
    ? AbortSignal.any([request.signal, xmlAbortController.signal])
    : xmlAbortController.signal
  
  let content = ''
  let thinkingContent = ''
  let response: LLMCompletionResponse | null = null
  
  const segments: MessageSegment[] = []
  let currentTextSegment = ''
  let currentThinkingSegment = ''
  
  // Timing tracking
  const startTime = performance.now()
  let firstTokenTime: number | null = null
  
  // Flush accumulated text to segments
  const flushText = () => {
    if (currentTextSegment) {
      segments.push({ type: 'text', content: currentTextSegment })
      currentTextSegment = ''
    }
  }
  
  // Flush accumulated thinking to segments
  const flushThinking = () => {
    if (currentThinkingSegment) {
      segments.push({ type: 'thinking', content: currentThinkingSegment })
      currentThinkingSegment = ''
    }
  }
  
  try {
    for await (const event of client.stream({ ...request, signal: combinedSignal })) {
      switch (event.type) {
        case 'text_delta':
          // Track first token time
          if (firstTokenTime === null) {
            firstTokenTime = performance.now()
          }
          // If we were accumulating thinking, flush it first
          flushThinking()
          content += event.content
          currentTextSegment += event.content
          
          // Check for XML tool syntax - abort immediately to save tokens
          if (hasXmlToolPattern(content)) {
            xmlAbortController.abort()
            yield { type: 'xml_tool_abort' }
            return null
          }
          
          yield { type: 'text_delta', content: event.content }
          break
          
        case 'thinking_delta':
          // Track first token time
          if (firstTokenTime === null) {
            firstTokenTime = performance.now()
          }
          // If we were accumulating text, flush it first
          flushText()
          thinkingContent += event.content
          currentThinkingSegment += event.content
          
          // Check for XML tool syntax in thinking too
          if (hasXmlToolPattern(thinkingContent)) {
            xmlAbortController.abort()
            yield { type: 'xml_tool_abort' }
            return null
          }
          
          yield { type: 'thinking_delta', content: event.content }
          break
          
        case 'done':
          // Flush any remaining content
          flushThinking()
          flushText()
          response = event.response
          yield { type: 'done', response: event.response }
          break
          
        case 'error':
          yield { type: 'error', error: event.error }
          return null
      }
    }
  } catch (error) {
    // AbortError is expected when we abort for XML detection
    if (error instanceof Error && error.name === 'AbortError') {
      return null
    }
    yield { type: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
    return null
  }
  
  if (!response) {
    return null
  }
  
  // Add tool call segments (references to the toolCalls array)
  const toolCalls = response.toolCalls ?? []
  for (const tc of toolCalls) {
    segments.push({ type: 'tool_call', toolCallId: tc.id })
  }
  
  // Calculate timing
  const endTime = performance.now()
  const ttft = ((firstTokenTime ?? endTime) - startTime) / 1000
  const completionTime = (endTime - (firstTokenTime ?? startTime)) / 1000
  const { promptTokens, completionTokens } = response.usage
  
  return {
    content,
    thinkingContent,
    toolCalls,
    response,
    segments,
    timing: {
      ttft,
      completionTime,
      tps: completionTime > 0 ? completionTokens / completionTime : 0,
      prefillTps: ttft > 0 ? promptTokens / ttft : 0,
    },
  }
}

/**
 * Builder for accumulating segments across multiple LLM calls.
 * Use this when you have a loop with multiple LLM calls + tool executions.
 */
export class SegmentBuilder {
  private segments: MessageSegment[] = []
  
  /**
   * Add segments from a streaming result.
   */
  addFromResult(result: StreamResult): void {
    this.segments.push(...result.segments)
  }
  
  /**
   * Manually add a tool call segment (for tool calls executed between LLM calls).
   */
  addToolCall(toolCallId: string): void {
    this.segments.push({ type: 'tool_call', toolCallId })
  }
  
  /**
   * Get all accumulated segments.
   */
  build(): MessageSegment[] {
    return [...this.segments]
  }
  
  /**
   * Clear all segments (for reuse).
   */
  clear(): void {
    this.segments = []
  }
}
