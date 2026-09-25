import { describe, it, expect } from 'vitest'
import { mergeSummaryInto, findLatestCompactionSummary } from './cumulative-summary.js'
import type { SnapshotMessage } from '../events/types.js'

function msg(id: string, content: string, ts: number, windowId?: string, isCompactionSummary = false): SnapshotMessage {
  return {
    id,
    role: 'assistant',
    content,
    timestamp: ts,
    ...(windowId !== undefined && { contextWindowId: windowId }),
    ...(isCompactionSummary && { isCompactionSummary }),
  }
}

describe('mergeSummaryInto', () => {
  it('wraps the bare summary in a marker on the first compaction', () => {
    expect(mergeSummaryInto('S1', null, '2024-01-16T10:00:00.000Z')).toBe('## Compacted 2024-01-16T10:00:00.000Z\nS1')
  })

  it('appends the new summary after the previous merged one (oldest first)', () => {
    const prev = '## Compacted 2024-01-16T10:00:00.000Z\nS1'
    expect(mergeSummaryInto('S2', prev, '2024-01-16T18:30:00.000Z')).toBe(
      `${prev}\n\n## Compacted 2024-01-16T18:30:00.000Z\nS2`,
    )
  })

  it('accumulates across multiple rounds', () => {
    const r1 = mergeSummaryInto('S1', null, 't1')
    const r2 = mergeSummaryInto('S2', r1, 't2')
    const r3 = mergeSummaryInto('S3', r2, 't3')
    expect(r3).toBe('## Compacted t1\nS1\n\n## Compacted t2\nS2\n\n## Compacted t3\nS3')
  })

  it('treats an empty previous value as first compaction', () => {
    expect(mergeSummaryInto('S1', '', 't1')).toBe('## Compacted t1\nS1')
  })

  it('uses the current local time when no timestamp is given', () => {
    const merged = mergeSummaryInto('S1', null)
    expect(merged).toMatch(/^## Compacted \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\nS1$/)
  })

  it('does not require the previous value to end with a newline', () => {
    expect(mergeSummaryInto('S2', 'S1', 't2')).toBe('S1\n\n## Compacted t2\nS2')
  })
})

describe('findLatestCompactionSummary', () => {
  it('returns the most recent top-level compaction summary', () => {
    const messages = [
      msg('s1', 'MERGED-ONE', 2000, 'w2', true),
      msg('m2', 'again', 2100, 'w2'),
      msg('s2', 'MERGED-TWO', 3000, 'w3', true),
      msg('m3', 'later', 3100, 'w3'),
    ]
    expect(findLatestCompactionSummary(messages)).toBe('MERGED-TWO')
  })

  it('returns null when there is no compaction summary (first window)', () => {
    const messages = [msg('m1', 'hello', 1000, 'w1')]
    expect(findLatestCompactionSummary(messages)).toBeNull()
  })

  it('ignores sub-agent summaries', () => {
    const messages: SnapshotMessage[] = [
      {
        id: 'sub',
        role: 'assistant',
        content: 'SUB',
        timestamp: 3000,
        contextWindowId: 'w3',
        isCompactionSummary: true,
        subAgentId: 'explorer-1',
      },
      msg('s1', 'TOP-LEVEL', 2000, 'w2', true),
    ]
    expect(findLatestCompactionSummary(messages)).toBe('TOP-LEVEL')
  })

  it('returns null for an empty list', () => {
    expect(findLatestCompactionSummary([])).toBeNull()
  })
})
