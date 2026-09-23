/**
 * Tests for `buildSessionStatsEventRollup`. Reproduces the reviewer's
 * scenario (200k window, 0.85 compaction threshold, many tool calls,
 * sub-agents, retries) and verifies the rollup numbers.
 */

import { describe, it, expect } from 'vitest'
import { buildSessionStatsEventRollup, type MinimalEvent } from './stats-rollup.js'

function mkTimestamp(ms: number): number {
  return new Date(2026, 0, 1, 0, 0, 0).getTime() + ms
}

function fixture200kWithCache(): MinimalEvent[] {
  const events: MinimalEvent[] = []
  let calls = 0
  let promptTokens = 0
  let time = 0
  while (calls < 373) {
    time += 1000
    const msgId = `m${calls}`
    events.push({ type: 'message.start', data: { messageId: msgId }, timestamp: mkTimestamp(time) })
    promptTokens += 5000
    if (promptTokens > 170000) {
      const before = promptTokens
      const after = 5000
      events.push({
        type: 'context.compacted',
        data: {
          closedWindowId: `w${calls}`,
          newWindowId: `w${calls + 1}`,
          beforeTokens: before,
          afterTokens: after,
          summary: 'compact',
        },
        timestamp: mkTimestamp(time + 500),
      })
      promptTokens = after
    }
    events.push({
      type: 'message.done',
      data: { messageId: msgId },
      timestamp: mkTimestamp(time + 900),
    })
    if (calls % 3 !== 0) {
      for (let t = 0; t < 2; t += 1) {
        events.push({
          type: 'tool.call',
          data: { messageId: msgId, toolCall: { id: `${msgId}-t${t}`, name: 'read_file' } },
          timestamp: mkTimestamp(time + 950),
        })
        const success = (calls + t) % 10 !== 0
        events.push({
          type: 'tool.result',
          data: {
            messageId: msgId,
            toolCallId: `${msgId}-t${t}`,
            result: { success, durationMs: 25 },
          },
          timestamp: mkTimestamp(time + 990),
        })
      }
    }
    calls += 1
  }
  events.push({
    type: 'pattern.retry',
    data: {
      messageId: 'm0',
      pattern: '<tool_call',
      field: 'content',
      attempt: 1,
      maxAttempts: 10,
      matchedContent: '...',
    },
    timestamp: mkTimestamp(time + 2000),
  })
  events.push({
    type: 'message.start',
    data: { messageId: 'm0', subAgentId: 'sa-1', subAgentType: 'explorer' },
    timestamp: mkTimestamp(time + 3000),
  })
  events.push({
    type: 'message.start',
    data: { messageId: 'm1', subAgentId: 'sa-2', subAgentType: 'verifier' },
    timestamp: mkTimestamp(time + 4000),
  })
  return events
}

describe('buildSessionStatsEventRollup', () => {
  it('reproduces the 200k-context-0.85-threshold scenario', () => {
    const rollup = buildSessionStatsEventRollup(fixture200kWithCache())
    expect(rollup.compactionCount).toBeGreaterThan(8)
    expect(rollup.compactionCount).toBeLessThan(25)
    expect(rollup.toolCalls).toBeGreaterThan(200)
    expect(rollup.toolErrors).toBeGreaterThan(0)
    expect(rollup.toolErrors).toBeLessThan(rollup.toolCalls)
    expect(rollup.subAgentCalls).toBe(2)
    expect(rollup.retryCount).toBe(1)
    for (const c of rollup.compactions) {
      expect(c.beforeTokens).toBeGreaterThan(170000)
      expect(c.afterTokens).toBeLessThan(c.beforeTokens)
      expect(c.reductionPercent).toBeGreaterThan(50)
    }
    expect(rollup.toolBreakdown.find((b) => b.toolName === 'read_file')?.count).toBeGreaterThan(300)
  })

  it('returns an empty rollup when no events are supplied', () => {
    const rollup = buildSessionStatsEventRollup([])
    expect(rollup.compactions).toEqual([])
    expect(rollup.retries).toEqual([])
    expect(rollup.toolCalls).toBe(0)
    expect(rollup.toolErrors).toBe(0)
    expect(rollup.subAgentCalls).toBe(0)
    expect(rollup.compactionCount).toBe(0)
    expect(rollup.retryCount).toBe(0)
    expect(rollup.toolBreakdown).toEqual([])
  })

  it('attributes compactions to the closest preceding responseIndex', () => {
    const idx = new Map([
      ['m0', 0],
      ['m1', 1],
      ['m2', 2],
    ])
    const ts0 = mkTimestamp(0)
    const ts1 = mkTimestamp(1000)
    const ts2 = mkTimestamp(2000)
    const ts3 = mkTimestamp(3000)
    const events: MinimalEvent[] = [
      { type: 'message.start', data: { messageId: 'm0' }, timestamp: ts0 },
      { type: 'message.done', data: { messageId: 'm0' }, timestamp: ts1 },
      { type: 'message.start', data: { messageId: 'm1' }, timestamp: ts1 },
      {
        type: 'context.compacted',
        data: { closedWindowId: 'w0', newWindowId: 'w1', beforeTokens: 1000, afterTokens: 0, summary: 'c' },
        timestamp: ts2,
      },
      { type: 'message.done', data: { messageId: 'm1' }, timestamp: ts2 },
      { type: 'message.start', data: { messageId: 'm2' }, timestamp: ts2 },
      { type: 'message.done', data: { messageId: 'm2' }, timestamp: ts3 },
    ]
    const rollup = buildSessionStatsEventRollup(events, idx)
    expect(rollup.compactions).toHaveLength(1)
    expect(rollup.compactions[0]!.beforeTokens).toBe(1000)
  })

  it('counts sub-agent only when subAgentId or subAgentType is present', () => {
    const events: MinimalEvent[] = [
      { type: 'message.start', data: { messageId: 'm0', subAgentId: 'sa-1', subAgentType: 'explorer' }, timestamp: 1 },
      { type: 'message.start', data: { messageId: 'm1' }, timestamp: 2 },
      { type: 'message.start', data: { messageId: 'm2', subAgentType: 'verifier' }, timestamp: 3 },
      { type: 'message.start', data: { messageId: 'm3', subAgentId: 'sa-3' }, timestamp: 4 },
    ]
    const rollup = buildSessionStatsEventRollup(events)
    expect(rollup.subAgentCalls).toBe(3)
  })

  it('backfills responseIndex on retry records from the messageId map', () => {
    const idx = new Map([
      ['m0', 2], // 0-based position of the message in the response progression
    ])
    const events: MinimalEvent[] = [
      {
        type: 'pattern.retry',
        data: { messageId: 'm0', pattern: '<tool_call', field: 'content', attempt: 1, maxAttempts: 5 },
        timestamp: 10,
      },
    ]
    const rollup = buildSessionStatsEventRollup(events, idx)
    expect(rollup.retries).toHaveLength(1)
    expect(rollup.retries[0]!.responseIndex).toBe(3)
    expect(rollup.retries[0]!.messageId).toBe('m0')
  })

  it('leaves responseIndex unset when no messageId map is supplied', () => {
    const events: MinimalEvent[] = [
      {
        type: 'pattern.retry',
        data: { messageId: 'm0', pattern: '<tool_call', field: 'content', attempt: 1, maxAttempts: 5 },
        timestamp: 10,
      },
    ]
    const rollup = buildSessionStatsEventRollup(events)
    expect(rollup.retries[0]!.responseIndex).toBeUndefined()
  })

  it('propagates tool errors via tool.result.success=false', () => {
    const events: MinimalEvent[] = [
      { type: 'message.start', data: { messageId: 'm0' }, timestamp: 1 },
      { type: 'tool.call', data: { messageId: 'm0', toolCall: { id: 't1', name: 'read_file' } }, timestamp: 2 },
      {
        type: 'tool.result',
        data: { messageId: 'm0', toolCallId: 't1', result: { success: false, durationMs: 10 } },
        timestamp: 3,
      },
      { type: 'tool.call', data: { messageId: 'm0', toolCall: { id: 't2', name: 'read_file' } }, timestamp: 4 },
      {
        type: 'tool.result',
        data: { messageId: 'm0', toolCallId: 't2', result: { success: true, durationMs: 10 } },
        timestamp: 5,
      },
    ]
    const rollup = buildSessionStatsEventRollup(events)
    expect(rollup.toolCalls).toBe(2)
    expect(rollup.toolErrors).toBe(1)
    expect(rollup.toolBreakdown.find((b) => b.toolName === 'read_file')?.errors).toBe(1)
  })
})
