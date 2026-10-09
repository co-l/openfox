import type { Message, ToolCall } from '@shared/types.js'

export type { Message, ToolCall }

// Display item: either a single message, a grouped sub-agent run, or a context window divider
export type DisplayItem =
  | { type: 'message'; message: Message }
  | { type: 'subagent'; subAgentId: string; subAgentType: string; messages: Message[] }
  | { type: 'context-divider'; windowSequence: number }

/**
 * Group messages into display items, collecting sub-agent messages by
 * subAgentId within each context window and emitting complete groups
 * in order of first occurrence.
 *
 * Unlike the previous adjacency-based approach, this correctly handles
 * interleaved messages from parallel sub-agent executions — all messages
 * for one sub-agent within a context window end up in a single group
 * regardless of interleaving.
 *
 * Context window boundaries split sub-agent groups: messages before and
 * after a compaction are in fundamentally different contexts and belong
 * in separate groups.
 *
 * This function preserves object identity for unchanged display items when given
 * a previousItems array, allowing React's memo() to skip unnecessary re-renders.
 */
export function groupMessages(messages: Message[], previousItems: DisplayItem[] = []): DisplayItem[] {
  // Create identity maps from previous items
  const previousItemsByMessageId = new Map<string, DisplayItem>()
  const previousItemsBySubAgentId = new Map<string, DisplayItem>()

  for (const item of previousItems) {
    if (item.type === 'message') {
      previousItemsByMessageId.set(item.message.id, item)
    } else if (item.type === 'subagent') {
      previousItemsBySubAgentId.set(item.subAgentId, item)
    }
  }

  const items: DisplayItem[] = []
  let lastContextWindowId: string | undefined
  let windowSequence = 1

  // Per-window sub-agent buckets: subAgentId → { subAgentType, messages }
  // Reset at each context window boundary so groups don't span compactions.
  let windowBuckets: Map<string, { subAgentType: string; messages: Message[] }> | null = null

  // First-occurrence position (among non-tool messages of the current
  // window) of each subAgentId, tracked during the single pass below so
  // flushing never re-scans the whole array (the previous per-flush scan
  // made this function O(N²) on long feeds).
  let firstOccurrenceInWindow = new Map<string, number>()
  let windowMessageIndex = 0

  const flushWindowBuckets = () => {
    if (!windowBuckets || windowBuckets.size === 0) return

    // Sort buckets by first occurrence and emit
    const sorted = [...windowBuckets.entries()].sort(
      (a, b) => (firstOccurrenceInWindow.get(a[0]) ?? 0) - (firstOccurrenceInWindow.get(b[0]) ?? 0),
    )

    for (const [subAgentId, bucket] of sorted) {
      const previousItem = previousItemsBySubAgentId.get(subAgentId)
      const messagesMatch =
        previousItem?.type === 'subagent' &&
        previousItem.messages.length === bucket.messages.length &&
        previousItem.messages.every((m, j) => m === bucket.messages[j])

      if (messagesMatch) {
        items.push(previousItem)
      } else {
        items.push({
          type: 'subagent',
          subAgentId,
          subAgentType: bucket.subAgentType,
          messages: bucket.messages,
        })
      }
    }

    windowBuckets = null
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.role === 'tool') continue

    // Detect context window boundary
    if (msg.contextWindowId && lastContextWindowId && msg.contextWindowId !== lastContextWindowId) {
      flushWindowBuckets()
      windowSequence++
      items.push({ type: 'context-divider', windowSequence })
    }
    if (msg.contextWindowId !== lastContextWindowId) {
      // Window changed (including the first window and undefined→defined):
      // restart first-occurrence tracking for the new window.
      firstOccurrenceInWindow = new Map()
      windowMessageIndex = 0
    }
    lastContextWindowId = msg.contextWindowId

    if (msg.subAgentId && !firstOccurrenceInWindow.has(msg.subAgentId)) {
      firstOccurrenceInWindow.set(msg.subAgentId, windowMessageIndex)
    }
    windowMessageIndex++

    if (msg.subAgentId && msg.subAgentType) {
      // Collect into per-window bucket
      if (!windowBuckets) windowBuckets = new Map()
      let bucket = windowBuckets.get(msg.subAgentId)
      if (!bucket) {
        bucket = { subAgentType: msg.subAgentType, messages: [] }
        windowBuckets.set(msg.subAgentId, bucket)
      }
      bucket.messages.push(msg)
    } else {
      // Regular message — flush pending buckets first so groups appear
      // before the next non-sub-agent message
      flushWindowBuckets()

      const previousItem = previousItemsByMessageId.get(msg.id)
      if (previousItem?.type === 'message' && previousItem.message === msg) {
        items.push(previousItem)
      } else {
        items.push({ type: 'message', message: msg })
      }
    }
  }

  // Flush remaining buckets
  flushWindowBuckets()

  return items
}
