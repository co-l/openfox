// Client-side end-time latches for assistant message blocks (unix ms), keyed
// by message id and tool call id. The session store latches a message's end
// when its live stream finalizes (`chat.message_updated` with isStreaming
// false) and a tool call's end when its result arrives (`chat.tool_result`).
// Module scope keeps the times alive across session switches, pane unmounts
// and re-fetches within the same page session; they intentionally do not
// survive a full page reload.
const MAX_BLOCK_TIMING_ENTRIES = 500

const messageEnds = new Map<string, number>()
const toolCallEnds = new Map<string, number>()

function latch(map: Map<string, number>, key: string): void {
  if (map.has(key)) return
  if (map.size >= MAX_BLOCK_TIMING_ENTRIES) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, Date.now())
}

/** Latch the end of a message; idempotent — the first latch wins. */
export function latchMessageEnd(messageId: string): void {
  latch(messageEnds, messageId)
}

/** The latched end of a message (unix ms), or undefined until latched. */
export function getMessageEnd(messageId: string): number | undefined {
  return messageEnds.get(messageId)
}

/** Latch the end of a tool call; idempotent — the first latch wins. */
export function latchToolCallEnd(callId: string): void {
  latch(toolCallEnds, callId)
}

/** The latched end of a tool call (unix ms), or undefined until latched. */
export function getToolCallEnd(callId: string): number | undefined {
  return toolCallEnds.get(callId)
}
