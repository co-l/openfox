import { useMemo } from 'react'
import { computeObservability } from '@shared/observability.js'
import type { Message, ObservabilitySnapshot, ObservabilityStats } from '@shared/types.js'

/**
 * Build a minimal event stream from the snapshot data needed by
 * computeObservability. This avoids requiring the full event log on
 * the client while still letting observability see compactions,
 * pattern retries, and tool calls.
 */
function buildEventsFromSnapshot(
  messages: Message[],
  snapshot: ObservabilitySnapshot | null | undefined,
): Array<{ type: string; data: Record<string, unknown>; timestamp: number }> {
  const events: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> = []

  if (snapshot?.contextWindows) {
    for (const record of snapshot.contextWindows) {
      events.push({
        type: 'context.compacted',
        data: {
          closedWindowId: record.closedWindowId,
          newWindowId: record.newWindowId,
          beforeTokens: record.beforeTokens,
          afterTokens: record.afterTokens,
          summary: '',
          ...(record.subAgentId ? { subAgentId: record.subAgentId } : {}),
          ...(record.subAgentType ? { subAgentType: record.subAgentType } : {}),
        },
        timestamp: record.timestamp,
      })
    }
  }

  if (snapshot?.formatRetries) {
    for (const record of snapshot.formatRetries) {
      events.push({
        type: 'pattern.retry',
        data: {
          pattern: '',
          field: '',
          attempt: record.attempt,
          maxAttempts: record.maxAttempts,
          messageId: '',
        },
        timestamp: record.timestamp,
      })
    }
  }

  for (const message of messages) {
    const timestamp = new Date(message.timestamp).getTime()
    if (message.role === 'assistant') {
      events.push({ type: 'message.start', data: { messageId: message.id }, timestamp })
      events.push({ type: 'message.done', data: { messageId: message.id, stats: message.stats }, timestamp })
      for (const toolCall of message.toolCalls ?? []) {
        events.push({
          type: 'tool.call',
          data: {
            messageId: message.id,
            toolCall: { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments },
          },
          timestamp,
        })
        if (toolCall.result) {
          events.push({
            type: 'tool.result',
            data: {
              messageId: message.id,
              toolCallId: toolCall.id,
              result: toolCall.result,
            },
            timestamp,
          })
        }
      }
    }
  }

  events.sort((a, b) => a.timestamp - b.timestamp)
  return events
}

/**
 * Compute observability stats from messages + an optional snapshot.
 * Returns null when no assistant message has stats.
 */
export function useObservability(
  messages: Message[],
  snapshot: ObservabilitySnapshot | null | undefined,
): ObservabilityStats | null {
  return useMemo(() => {
    const events = buildEventsFromSnapshot(messages, snapshot)
    return computeObservability(messages, events)
  }, [messages, snapshot])
}
