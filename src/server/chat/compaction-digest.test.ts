import { describe, it, expect } from 'vitest'
import type { StoredEvent, SessionSnapshot } from '../events/types.js'
import { buildCompactionDigest } from './compaction-digest.js'

let seq = 0
function ev(type: string, data: unknown, timestamp?: number, explicitSeq?: number): StoredEvent {
  const s = explicitSeq ?? ++seq
  return {
    seq: s,
    timestamp: timestamp ?? 1000 + s,
    sessionId: 's1',
    type: type as StoredEvent['type'],
    data: data as StoredEvent['data'],
  }
}

function init(wid: string): StoredEvent {
  return ev('session.initialized', { projectId: 'p', workdir: '/w', contextWindowId: wid }, 1000)
}

function user(id: string, wid: string | undefined, content = 'hello', ts?: number, explicitSeq?: number): StoredEvent {
  return ev(
    'message.start',
    {
      messageId: id,
      role: 'user',
      content,
      ...(wid !== undefined && { contextWindowId: wid }),
    },
    ts,
    explicitSeq,
  )
}

function seed(id: string, wid: string, content: string, ts: number, explicitSeq?: number): StoredEvent {
  return ev(
    'message.start',
    {
      messageId: id,
      role: 'assistant',
      content,
      contextWindowId: wid,
      isCompactionSummary: true,
    },
    ts,
    explicitSeq,
  )
}

const iso = (ts: number): string => new Date(ts).toISOString()

describe('buildCompactionDigest', () => {
  it('returns null for digestRound=0 even when prior seeds exist', () => {
    const events = [
      init('window-1'),
      user('m1', 'window-1'),
      seed('s1', 'window-2', 'SUMMARY-ONE', 2000),
      user('m2', 'window-2'),
    ]
    expect(buildCompactionDigest(events, 0, 'window-2')).toBeNull()
  })

  it('returns null for zero prior rounds (first compaction) even with -1', () => {
    const events = [init('window-1'), user('m1', 'window-1')]
    expect(buildCompactionDigest(events, -1, 'window-1')).toBeNull()
  })

  it('builds full digest with -1: ordered headers, verbatim bodies, seed pointer, entries', () => {
    const events = [
      init('window-1'),
      user('m1', 'window-1'),
      seed('s1', 'window-2', 'SUMMARY-ONE', 2000),
      user('m2', 'window-2'),
      seed('s2', 'window-3', 'SUMMARY-TWO', 3000),
      user('m3', 'window-3'),
    ]
    const digest = buildCompactionDigest(events, -1, 'window-3')
    expect(digest).not.toBeNull()
    if (!digest) return
    // windowId = the round's own window; messageId = the seed stored one window later
    expect(digest.entries).toEqual([
      { round: 1, windowId: 'window-1', messageId: 's1', summarizedAt: iso(2000) },
      { round: 2, windowId: 'window-2', messageId: 's2', summarizedAt: iso(3000) },
    ])
    expect(digest.content).toContain('## Round 1 — summarized ' + iso(2000))
    expect(digest.content).toContain('## Round 2 — summarized ' + iso(3000))
    expect(digest.content).toContain('SUMMARY-ONE')
    expect(digest.content).toContain('SUMMARY-TWO')
    expect(digest.content).toContain('compaction summary of Round 3')
    expect(digest.content).not.toContain('Note:')
    expect(digest.content.indexOf('SUMMARY-ONE')).toBeLessThan(digest.content.indexOf('SUMMARY-TWO'))
    expect(digest.content).not.toContain('---')
  })

  it('caps at k rounds with a truncation note', () => {
    const events = [
      init('window-1'),
      user('m1', 'window-1'),
      seed('s1', 'window-2', 'SUMMARY-ONE', 2000),
      seed('s2', 'window-3', 'SUMMARY-TWO', 3000),
      seed('s3', 'window-4', 'SUMMARY-THREE', 4000),
      user('m4', 'window-4'),
    ]
    const digest = buildCompactionDigest(events, 1, 'window-4')
    expect(digest).not.toBeNull()
    if (!digest) return
    expect(digest.entries).toEqual([{ round: 3, windowId: 'window-3', messageId: 's3', summarizedAt: iso(4000) }])
    expect(digest.content).toContain('SUMMARY-THREE')
    expect(digest.content).not.toContain('SUMMARY-ONE')
    expect(digest.content).not.toContain('SUMMARY-TWO')
    expect(digest.content).toContain('most recent 1 round summaries are included below')
    expect(digest.content).toContain('compaction summary of Round 4')
  })

  it('treats k >= available as full (no truncation note)', () => {
    const events = [
      init('window-1'),
      seed('s1', 'window-2', 'SUMMARY-ONE', 2000),
      seed('s2', 'window-3', 'SUMMARY-TWO', 3000),
    ]
    const digest = buildCompactionDigest(events, 5, 'window-3')
    expect(digest).not.toBeNull()
    if (!digest) return
    expect(digest.entries.map((e) => e.round)).toEqual([1, 2])
    expect(digest.content).not.toContain('Note:')
  })

  it('excludes sub-agent summaries from the digest and round numbering', () => {
    const events = [
      init('window-1'),
      user('m1', 'window-1'),
      ev(
        'message.start',
        {
          messageId: 'sub-seed',
          role: 'assistant',
          content: 'SUB-AGENT-SUMMARY',
          contextWindowId: 'window-2',
          isCompactionSummary: true,
          subAgentId: 'explorer-1',
        },
        1500,
      ),
      seed('s1', 'window-2', 'SUMMARY-ONE', 2000),
    ]
    const digest = buildCompactionDigest(events, -1, 'window-2')
    expect(digest).not.toBeNull()
    if (!digest) return
    expect(digest.content).not.toContain('SUB-AGENT-SUMMARY')
    expect(digest.entries.map((e) => e.round)).toEqual([1])
  })

  it('numbers rounds from first appearance when session.initialized is missing (legacy)', () => {
    const events = [
      user('m1', undefined, 'legacy message'),
      seed('s1', 'window-2', 'SUMMARY-ONE', 2000),
      seed('s2', 'window-3', 'SUMMARY-TWO', 3000),
    ]
    const digest = buildCompactionDigest(events, -1, 'window-3')
    expect(digest).not.toBeNull()
    if (!digest) return
    expect(digest.entries.map((e) => e.round)).toEqual([1, 2])
    expect(digest.entries[0]!.windowId).toBe('legacy-window-1')
  })

  it('matches the raw-event digest when built from snapshot + post-snapshot events (parity)', () => {
    const rawEvents = [
      init('window-1'),
      user('m1', 'window-1', 'hello', 1100, 2),
      seed('s1', 'window-2', 'SUMMARY-ONE', 2000, 3),
      user('m2', 'window-2', 'again', 2100, 4),
      seed('s2', 'window-3', 'SUMMARY-TWO', 3000, 5),
      user('m3', 'window-3', 'more', 3100, 6),
    ]
    const rawDigest = buildCompactionDigest(rawEvents, -1, 'window-3')
    expect(rawDigest).not.toBeNull()

    const snapshot: SessionSnapshot = {
      mode: 'builder',
      phase: 'plan',
      isRunning: false,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'hello',
          timestamp: 1100,
          contextWindowId: 'window-1',
        },
        {
          id: 's1',
          role: 'assistant',
          content: 'SUMMARY-ONE',
          timestamp: 2000,
          contextWindowId: 'window-2',
          isCompactionSummary: true,
        },
        { id: 'm2', role: 'user', content: 'again', timestamp: 2100, contextWindowId: 'window-2' },
      ],
      criteria: [],
      metadataEntries: {},
      contextState: {
        currentTokens: 10,
        maxTokens: 200000,
        compactionCount: 1,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      },
      currentContextWindowId: 'window-3',
      todos: [],
      snapshotSeq: 4,
      snapshotAt: 2200,
      sessionInit: { projectId: 'p', workdir: '/w', contextWindowId: 'window-1' },
    }
    const mixedEvents: StoredEvent[] = [
      {
        seq: 1,
        timestamp: 1000,
        sessionId: 's1',
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'window-1' },
      },
      { seq: 4, timestamp: 2200, sessionId: 's1', type: 'turn.snapshot', data: snapshot },
      rawEvents[4]!,
      rawEvents[5]!,
    ]
    const mixedDigest = buildCompactionDigest(mixedEvents, -1, 'window-3')
    expect(mixedDigest).not.toBeNull()
    expect(mixedDigest!.entries).toEqual(rawDigest!.entries)
    expect(mixedDigest!.content).toEqual(rawDigest!.content)
  })
})
