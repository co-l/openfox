/**
 * Tool streaming utilities
 *
 * Handles conversion of tool onProgress callbacks to tool.output events.
 * Used for streaming shell command output to the client in real-time.
 */

import type { TurnEvent } from '../events/types.js'

export interface ParsedProgress {
  stream: 'stdout' | 'stderr'
  content: string
}

// A chatty command (e.g. a process printing in a tight loop) can emit
// thousands of stdout chunks per second; persisting each one as a tool.output
// event bloats the session log (observed: 172k events / 472 MB for one call).
// The final tool.result already carries the complete (truncated) output, so
// the persisted streaming chunks only serve live display and crash recovery —
// capping them keeps the log bounded without losing the result.
export const MAX_TOOL_OUTPUT_EVENTS_PER_CALL = 500

/**
 * Parse a progress message from the shell tool.
 * Shell tool emits messages in format: "[stdout] content" or "[stderr] content"
 *
 * @returns Parsed progress or null if format doesn't match
 */
export function parseProgressMessage(message: string): ParsedProgress | null {
  const match = message.match(/^\[(stdout|stderr)\] (.*)$/s)
  if (!match) return null

  return {
    stream: match[1] as 'stdout' | 'stderr',
    content: match[2]!,
  }
}

/**
 * Create an onProgress handler that emits tool.output events.
 *
 * @param append - Function to append events (e.g., eventStore.append(sessionId, event))
 * @param messageId - The assistant message ID this tool call belongs to
 * @param callId - The tool call ID
 * @param sessionId - The session ID
 * @returns Progress handler function to pass to tool context
 */
export function createToolProgressHandler(
  append: (event: TurnEvent) => void,
  messageId: string,
  callId: string,
  _sessionId: string,
): (message: string) => void {
  let emitted = 0
  return (message: string) => {
    const parsed = parseProgressMessage(message)
    if (!parsed) return
    if (emitted >= MAX_TOOL_OUTPUT_EVENTS_PER_CALL) return
    emitted++

    append({
      type: 'tool.output',
      data: { messageId, toolCallId: callId, stream: parsed.stream, content: parsed.content },
    })
  }
}
