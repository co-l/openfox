import { describe, it, expect } from 'vitest'
import { combineEventsWithSnapshot } from '../server/events/session.js'
import { buildSessionStatsEventRollup } from './stats-rollup.js'
import type { SessionSnapshot, StoredEvent, SnapshotMessage, CompactionRecord } from '../server/events/types.js'

function ev(seq: number, timestamp: number, type: string, data: Record<string, unknown>): StoredEvent {
  return { seq, timestamp, sessionId: 's1', type, data } as StoredEvent
}

function defaultContextState() {
  return {
    currentTokens: 0,
    maxTokens: 200000,
    compactionCount: 0,
    dangerZone: false,
    canCompact: true,
    dynamicContextChanged: false,
  }
}

const baseSnapshot = {
  mode: 'planner',
  phase: 'build',
  isRunning: false,
  messages: [] as SnapshotMessage[],
  criteria: [],
  metadataEntries: {},
  contextState: defaultContextState(),
  currentContextWindowId: 'w1',
  todos: [],
  formatRetries: [{ attempt: 1, maxAttempts: 10, timestamp: 500 }],
  contextWindows: [
    {
      timestamp: 700,
      closedWindowId: 'w0',
      newWindowId: 'w1',
      beforeTokens: 175000,
      afterTokens: 0,
    },
  ] as unknown as CompactionRecord[],
  snapshotSeq: 0,
  snapshotAt: 2000,
} as SessionSnapshot

const baseRaw = [
  ev(1, 3000, 'message.start', { messageId: 'm1', role: 'assistant' }),
  ev(2, 3100, 'tool.call', {
    messageId: 'm1',
    toolCall: { id: 't3', name: 'read_file' },
  }),
  ev(3, 3200, 'tool.result', {
    messageId: 'm1',
    toolCallId: 't3',
    result: { success: true, durationMs: 3 },
  }),
  ev(4, 3300, 'message.done', { messageId: 'm1' }),
]

describe('snapshot cycle (rollup-only)', () => {
  it('reproduces the bug: without reconstruction, historical compactions and retries are LOST', () => {
    const rollup = buildSessionStatsEventRollup(baseRaw)
    expect(rollup.compactions.length).toBe(0)
    expect(rollup.retries.length).toBe(0)
    expect(rollup.toolCalls).toBe(1)
  })

  it('reconstructs snapshot events when combined through combineEventsWithSnapshot', () => {
    const combined = combineEventsWithSnapshot('s1', baseSnapshot, baseRaw)
    const rollup = buildSessionStatsEventRollup(combined)
    expect(rollup.compactions.length).toBe(1)
    expect(rollup.retries.length).toBe(1)
    expect(rollup.toolCalls).toBe(1) // post-snapshot only; tools live on snapshot.messages
  })

  it('handles multiple compactions and retries in the snapshot', () => {
    const snapshot = {
      ...baseSnapshot,
      formatRetries: [
        { attempt: 1, maxAttempts: 10, timestamp: 100 },
        { attempt: 1, maxAttempts: 10, timestamp: 200 },
        { attempt: 1, maxAttempts: 10, timestamp: 300 },
      ],
      contextWindows: [
        { timestamp: 100, closedWindowId: 'w0', newWindowId: 'w1', beforeTokens: 80000, afterTokens: 0 },
        { timestamp: 200, closedWindowId: 'w1', newWindowId: 'w2', beforeTokens: 100000, afterTokens: 0 },
        { timestamp: 300, closedWindowId: 'w2', newWindowId: 'w3', beforeTokens: 150000, afterTokens: 0 },
      ],
    } as SessionSnapshot
    const combined = combineEventsWithSnapshot('s1', snapshot, baseRaw)
    const rollup = buildSessionStatsEventRollup(combined)
    expect(rollup.compactions.length).toBe(3)
    expect(rollup.retries.length).toBe(3)
  })

  it('preserves post-snapshot compactions alongside the snapshot ones', () => {
    const snapshot = {
      ...baseSnapshot,
      contextWindows: [
        {
          timestamp: 700,
          closedWindowId: 'w0',
          newWindowId: 'w1',
          beforeTokens: 175000,
          afterTokens: 0,
        },
      ],
    } as SessionSnapshot
    const rawEventsWithPostCompaction = [
      ...baseRaw,
      ev(5, 4000, 'context.compacted', {
        closedWindowId: 'w1',
        newWindowId: 'w2',
        beforeTokens: 50000,
        afterTokens: 0,
        summary: '',
      }),
    ]
    const combined = combineEventsWithSnapshot('s1', snapshot, rawEventsWithPostCompaction)
    const rollup = buildSessionStatsEventRollup(combined)
    expect(rollup.compactions.length).toBe(2) // snapshot + post
  })

  it('produces the same counts with zero, one, or many snapshots (no double-count)', () => {
    const r0 = buildSessionStatsEventRollup(baseRaw)
    expect(r0.compactions.length).toBe(0)

    const r1 = buildSessionStatsEventRollup(combineEventsWithSnapshot('s1', baseSnapshot, baseRaw))
    expect(r1.compactions.length).toBe(1)
    expect(r1.retries.length).toBe(1)

    const combinedTwice = combineEventsWithSnapshot(
      's1',
      baseSnapshot,
      combineEventsWithSnapshot('s1', baseSnapshot, baseRaw),
    )
    const r2 = buildSessionStatsEventRollup(combinedTwice)
    expect(r2.compactions.length).toBe(2)
  })
})

// ============================================================================
// Historical tool activity reconstruction from snapshot.messages[].toolCalls
// ============================================================================

describe('historical tool activity from snapshot.messages[].toolCalls', () => {
  it('reconstructs tool.call + tool.result from snapshot.messages[].toolCalls', () => {
    const snapshot = {
      ...baseSnapshot,
      contextWindows: [] as CompactionRecord[],
      formatRetries: [],
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: '',
          timestamp: 100,
          toolCalls: [
            {
              id: 'tA',
              name: 'read_file',
              arguments: { path: '/a' },
              result: { success: true, durationMs: 5, truncated: false },
            },
          ],
        },
        {
          id: 'm2',
          role: 'assistant',
          content: '',
          timestamp: 200,
          toolCalls: [
            {
              id: 'tB',
              name: 'run_command',
              arguments: { command: 'ls' },
              result: { success: false, error: 'ENOENT', durationMs: 7, truncated: false },
            },
          ],
        },
      ] as SnapshotMessage[],
    } as SessionSnapshot
    const combined = combineEventsWithSnapshot('s1', snapshot, [])
    const rollup = buildSessionStatsEventRollup(combined)
    expect(rollup.toolCalls).toBe(2)
    expect(rollup.toolErrors).toBe(1)
    expect(rollup.toolBreakdown.find((b) => b.toolName === 'read_file')?.count).toBe(1)
    expect(rollup.toolBreakdown.find((b) => b.toolName === 'run_command')?.errors).toBe(1)
    // categorize sub-agent tools via classifyTool
    expect(rollup.toolBreakdown.find((b) => b.toolName === 'read_file')?.category).toBe('read')
  })

  it('does not double-count when post-snapshot events already cover the same toolCall.id', () => {
    const snapshot = {
      ...baseSnapshot,
      contextWindows: [] as CompactionRecord[],
      formatRetries: [],
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: '',
          timestamp: 100,
          toolCalls: [
            {
              id: 't1',
              name: 'read_file',
              arguments: {},
              result: { success: true, durationMs: 1, truncated: false },
            },
          ],
        },
      ] as SnapshotMessage[],
    } as SessionSnapshot
    const rawPost = [
      ev(10, 2000, 'tool.call', { messageId: 'm1', toolCall: { id: 't1', name: 'read_file' } }),
      ev(11, 2100, 'tool.result', {
        messageId: 'm1',
        toolCallId: 't1',
        result: { success: true, durationMs: 1 },
      }),
    ]
    const combined = combineEventsWithSnapshot('s1', snapshot, rawPost)
    const rollup = buildSessionStatsEventRollup(combined)
    expect(rollup.toolCalls).toBe(1)
  })

  it('a 171-toolCall legacy snapshot rebuilds to toolCalls=171', () => {
    const toolCalls = Array.from({ length: 171 }, (_, i) => ({
      id: `tc_${i}`,
      name: i % 3 === 0 ? 'read_file' : 'run_command',
      arguments: { i },
      result: { success: true, durationMs: 1, truncated: false },
    }))
    const messages = toolCalls.map((tc, i) => ({
      id: `m_${i}`,
      role: 'assistant',
      content: '',
      timestamp: 1000 + i,
      toolCalls: [tc],
    }))
    const snapshot = {
      ...baseSnapshot,
      contextWindows: [] as CompactionRecord[],
      formatRetries: [],
      messages: messages as SnapshotMessage[],
    } as SessionSnapshot
    const combined = combineEventsWithSnapshot('s1', snapshot, [])
    const rollup = buildSessionStatsEventRollup(combined)
    expect(rollup.toolCalls).toBe(171)
  })
})

// ============================================================================
// Legacy compactionCount preservation
// ============================================================================

describe('legacy compactionCount (snapshot.contextWindows empty, contextState.compactionCount > 0)', () => {
  function legacySnapshot(count: number) {
    return {
      ...baseSnapshot,
      contextWindows: [] as CompactionRecord[],
      formatRetries: [],
      contextState: {
        ...defaultContextState(),
        compactionCount: count,
      },
    } as SessionSnapshot
  }

  it('preserves the count when details are absent (compactions=[])', () => {
    const snap = legacySnapshot(2)
    const combined = combineEventsWithSnapshot('s1', snap, [])
    const rollup = buildSessionStatsEventRollup(combined, undefined, {
      legacyCompactionCount: 2,
    })
    expect(rollup.compactionCount).toBe(2)
    expect(rollup.compactions).toEqual([])
    expect(rollup.compactionsDetailsAvailable).toBe(false)
  })

  it('adds legacy baseline + post-snapshot compactions without duplication', () => {
    const snap = legacySnapshot(2)
    const rawPost = [
      ev(50, 5000, 'context.compacted', {
        closedWindowId: 'w2',
        newWindowId: 'w3',
        beforeTokens: 100,
        afterTokens: 0,
        summary: '',
      }),
    ]
    const combined = combineEventsWithSnapshot('s1', snap, rawPost)
    const rollup = buildSessionStatsEventRollup(combined, undefined, {
      legacyCompactionCount: 2,
    })
    expect(rollup.compactionCount).toBe(3) // 2 legacy + 1 post
    expect(rollup.compactions.length).toBe(1) // only the post event has details
    expect(rollup.compactionsDetailsAvailable).toBe(false) // historical details remain partial
  })

  it('modern snapshot with contextWindows sets details available', () => {
    const combined = combineEventsWithSnapshot('s1', baseSnapshot, [])
    const rollup = buildSessionStatsEventRollup(combined)
    expect(rollup.compactionCount).toBe(1)
    expect(rollup.compactions.length).toBe(1)
    expect(rollup.compactionsDetailsAvailable).toBe(true)
  })
})

// ============================================================================
// Multi-snapshot cycle: toolCalls and contextWindows preserved cumulatively
// ============================================================================

describe('multi-snapshot cycle (raw → snap1 → prune → snap2 → prune → reload)', () => {
  it('keeps toolCalls cumulative across snapshots', () => {
    // Snapshot 1: 1 historical tool call
    const snap1 = {
      ...baseSnapshot,
      contextWindows: [] as CompactionRecord[],
      formatRetries: [],
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: '',
          timestamp: 100,
          toolCalls: [
            {
              id: 'tA',
              name: 'read_file',
              arguments: {},
              result: { success: true, durationMs: 1, truncated: false },
            },
          ],
        },
      ] as SnapshotMessage[],
    } as SessionSnapshot
    const combined1 = combineEventsWithSnapshot('s1', snap1, [])
    expect(buildSessionStatsEventRollup(combined1).toolCalls).toBe(1)

    // Snapshot 2 builds on snapshot 1: historical tA + new tB
    const snap2 = {
      ...baseSnapshot,
      contextWindows: [] as CompactionRecord[],
      formatRetries: [],
      messages: [
        ...snap1.messages,
        {
          id: 'm2',
          role: 'assistant',
          content: '',
          timestamp: 500,
          toolCalls: [
            {
              id: 'tB',
              name: 'write_file',
              arguments: {},
              result: { success: true, durationMs: 2, truncated: false },
            },
          ],
        },
      ] as SnapshotMessage[],
    } as SessionSnapshot
    const combined2 = combineEventsWithSnapshot('s1', snap2, [])
    const r2 = buildSessionStatsEventRollup(combined2)
    expect(r2.toolCalls).toBe(2)
    expect(r2.toolBreakdown.find((b) => b.toolName === 'read_file')?.count).toBe(1)
    expect(r2.toolBreakdown.find((b) => b.toolName === 'write_file')?.count).toBe(1)
  })

  it('keeps contextWindows cumulative across snapshots', () => {
    const snap1 = {
      ...baseSnapshot,
      contextWindows: [
        {
          timestamp: 100,
          closedWindowId: 'w0',
          newWindowId: 'w1',
          beforeTokens: 80000,
          afterTokens: 0,
        },
      ] as CompactionRecord[],
      formatRetries: [],
      messages: [] as SnapshotMessage[],
    } as SessionSnapshot
    expect(buildSessionStatsEventRollup(combineEventsWithSnapshot('s1', snap1, [])).compactions.length).toBe(1)

    const snap2 = {
      ...baseSnapshot,
      contextWindows: [
        ...(snap1.contextWindows ?? []),
        {
          timestamp: 200,
          closedWindowId: 'w1',
          newWindowId: 'w2',
          beforeTokens: 100000,
          afterTokens: 0,
        },
      ] as CompactionRecord[],
      formatRetries: [],
      messages: [] as SnapshotMessage[],
    } as SessionSnapshot
    expect(buildSessionStatsEventRollup(combineEventsWithSnapshot('s1', snap2, [])).compactions.length).toBe(2)
  })

  it('keeps formatRetries cumulative across snapshots', () => {
    const snap1 = {
      ...baseSnapshot,
      contextWindows: [] as CompactionRecord[],
      formatRetries: [{ attempt: 1, maxAttempts: 10, timestamp: 100 }],
      messages: [] as SnapshotMessage[],
    } as SessionSnapshot
    expect(buildSessionStatsEventRollup(combineEventsWithSnapshot('s1', snap1, [])).retries.length).toBe(1)

    const snap2 = {
      ...baseSnapshot,
      contextWindows: [] as CompactionRecord[],
      formatRetries: [...(snap1.formatRetries ?? []), { attempt: 2, maxAttempts: 10, timestamp: 200 }],
      messages: [] as SnapshotMessage[],
    } as SessionSnapshot
    expect(buildSessionStatsEventRollup(combineEventsWithSnapshot('s1', snap2, [])).retries.length).toBe(2)
  })

  it('post-snapshot tool call added once, never duplicated', () => {
    const snap = {
      ...baseSnapshot,
      contextWindows: [] as CompactionRecord[],
      formatRetries: [],
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: '',
          timestamp: 100,
          toolCalls: [
            {
              id: 't1',
              name: 'read_file',
              arguments: {},
              result: { success: true, durationMs: 1, truncated: false },
            },
          ],
        },
      ] as SnapshotMessage[],
    } as SessionSnapshot
    const rawPost = [
      ev(10, 2000, 'tool.call', { messageId: 'm2', toolCall: { id: 'tNew', name: 'run_command' } }),
      ev(11, 2100, 'tool.result', {
        messageId: 'm2',
        toolCallId: 'tNew',
        result: { success: true, durationMs: 5 },
      }),
    ]
    const rollup = buildSessionStatsEventRollup(combineEventsWithSnapshot('s1', snap, rawPost))
    expect(rollup.toolCalls).toBe(2)
  })
})
