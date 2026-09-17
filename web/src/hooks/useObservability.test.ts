/**
 * Tests for the observability layer used by the StatsModal dashboard.
 *
 * The hook is tested indirectly through the pure `computeObservability`
 * function so that we exercise the same code path without depending on
 * a React rendering environment.
 */

import { describe, it, expect } from 'vitest'
import { computeObservability } from '@shared/observability.js'
import type { Message, MessageStats, ObservabilitySnapshot } from '@shared/types.js'

function makeStats(overrides: Partial<MessageStats> = {}): MessageStats {
  return {
    providerId: 'p1',
    providerName: 'Local',
    backend: 'vllm',
    model: 'm',
    mode: 'planner',
    totalTime: 5,
    toolTime: 1,
    prefillTokens: 1000,
    prefillSpeed: 10000,
    generationTokens: 50,
    generationSpeed: 100,
    llmCalls: [
      {
        providerId: 'p1',
        providerName: 'Local',
        backend: 'vllm',
        model: 'm',
        callIndex: 1,
        promptTokens: 1000,
        completionTokens: 50,
        cachedPromptTokens: 800,
        cacheSource: 'provider',
        ttft: 0.1,
        completionTime: 0.5,
        prefillSpeed: 10000,
        generationSpeed: 100,
        totalTime: 0.6,
        retries: 0,
      },
    ],
    ...overrides,
  }
}

function makeMessage(
  id: string,
  stats: MessageStats,
  timestamp: string,
  toolCalls: Array<{ id: string; name: string }> = [],
): Message {
  return {
    id,
    role: 'assistant',
    content: 'ok',
    timestamp,
    stats,
    toolCalls: toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: {},
      result: { success: true, output: '', durationMs: 10, truncated: false },
    })),
  }
}

function snapshotFromEvents(): ObservabilitySnapshot {
  return {
    contextWindows: [
      {
        timestamp: Date.parse('2024-01-01T00:01:00Z'),
        closedWindowId: 'w1',
        newWindowId: 'w2',
        beforeTokens: 175000,
        afterTokens: 0,
        reduction: 175000,
        reductionPercent: 100,
      },
    ],
  }
}

describe('observability layer (used by StatsModal)', () => {
  it('returns null for empty messages', () => {
    expect(computeObservability([], [])).toBeNull()
  })

  it('builds observability stats with provider cache', () => {
    const stats = makeStats()
    const messages = [makeMessage('m1', stats, '2024-01-01T00:00:00Z')]
    const result = computeObservability(messages, [])
    expect(result).not.toBeNull()
    expect(result!.summary.cacheSource).toBe('provider')
    expect(result!.summary.providerCachedTokens).toBe(800)
    expect(result!.summary.contextAmplificationFactor).toBeCloseTo(5, 5)
  })

  it('reads compactions from the snapshot', () => {
    const stats = makeStats()
    const messages = [makeMessage('m1', stats, '2024-01-01T00:00:00Z')]
    const snapshot = snapshotFromEvents()
    const syntheticEvents = (snapshot.contextWindows ?? []).map((c) => ({
      type: 'context.compacted',
      data: {
        closedWindowId: c.closedWindowId,
        newWindowId: c.newWindowId,
        beforeTokens: c.beforeTokens,
        afterTokens: c.afterTokens,
        summary: '',
      },
      timestamp: c.timestamp,
    }))
    const result = computeObservability(messages, syntheticEvents)
    expect(result).not.toBeNull()
    expect(result!.compactions).toHaveLength(1)
    expect(result!.summary.compactions).toBe(1)
  })

  it('captures tool calls from message.toolCalls', () => {
    const stats = makeStats()
    const messages = [
      makeMessage('m1', stats, '2024-01-01T00:00:00Z', [
        { id: 'tc1', name: 'read_file' },
        { id: 'tc2', name: 'run_command' },
      ]),
    ]
    const events = [
      { type: 'message.start', data: { messageId: 'm1' }, timestamp: 0 },
      { type: 'message.done', data: { messageId: 'm1' }, timestamp: 1 },
      {
        type: 'tool.call',
        data: { messageId: 'm1', toolCall: { id: 'tc1', name: 'read_file' } },
        timestamp: 2,
      },
      {
        type: 'tool.result',
        data: { messageId: 'm1', toolCallId: 'tc1', result: { success: true, durationMs: 10 } },
        timestamp: 3,
      },
      {
        type: 'tool.call',
        data: { messageId: 'm1', toolCall: { id: 'tc2', name: 'run_command' } },
        timestamp: 4,
      },
      {
        type: 'tool.result',
        data: { messageId: 'm1', toolCallId: 'tc2', result: { success: true, durationMs: 20 } },
        timestamp: 5,
      },
    ]
    const result = computeObservability(messages, events)
    expect(result).not.toBeNull()
    expect(result!.toolActivity.totalCount).toBe(2)
    expect(result!.toolActivity.byCategory.read).toBe(1)
    expect(result!.toolActivity.byCategory.shell).toBe(1)
  })
})
