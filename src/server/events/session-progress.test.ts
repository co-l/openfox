// @vitest-environment node
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { buildSnapshot, buildSnapshotFromSessionState, foldLastProgressAt, foldSessionState } from './folding.js'
import type { EventLike } from './folding.js'
import { EventStore } from './store.js'
import type { SessionSnapshot } from './types.js'

function event(type: EventLike['type'], data: EventLike['data'], timestamp: number): EventLike {
  return { type, data, timestamp }
}

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    mode: 'builder',
    phase: 'build',
    isRunning: true,
    messages: [],
    criteria: [],
    metadataEntries: {},
    contextState: {
      currentTokens: 0,
      maxTokens: 200000,
      compactionCount: 0,
      dangerZone: false,
      canCompact: false,
      dynamicContextChanged: false,
    },
    currentContextWindowId: 'window-1',
    todos: [],
    snapshotSeq: 1,
    snapshotAt: 1000,
    ...overrides,
  }
}

describe('foldLastProgressAt', () => {
  it('does not treat ordinary activity as progress', () => {
    const events: EventLike[] = [
      event('message.start', { messageId: 'm1', role: 'assistant' }, 1000),
      event('message.delta', { messageId: 'm1', content: 'working' }, 2000),
      event(
        'tool.call',
        {
          messageId: 'm1',
          toolCall: { id: 't1', name: 'run_command', arguments: { command: 'npm test' } },
        },
        3000,
      ),
      event(
        'tool.result',
        {
          messageId: 'm1',
          toolCallId: 't1',
          result: { success: true, output: 'ok', durationMs: 1, truncated: false },
        },
        4000,
      ),
      event('chat.done', { messageId: 'm1', reason: 'complete' }, 5000),
    ]
    expect(foldLastProgressAt(events)).toBeNull()
  })

  it('recognizes structured criteria progress', () => {
    const events: EventLike[] = [
      event(
        'criteria.set',
        {
          criteria: [{ id: 'c1', description: 'One', status: { type: 'pending' }, attempts: [] }],
        },
        1000,
      ),
      event(
        'criterion.updated',
        {
          criterionId: 'c1',
          status: { type: 'completed', completedAt: '2024-01-02T03:04:05.000Z' },
        },
        2000,
      ),
      event(
        'criterion.updated',
        {
          criterionId: 'c1',
          status: { type: 'passed', verifiedAt: '2024-01-03T03:04:05.000Z' },
        },
        3000,
      ),
    ]
    expect(foldLastProgressAt(events)).toBe(new Date(3000).toISOString())
  })

  it('recognizes criteria.set transitions to completed and passed', () => {
    const events: EventLike[] = [
      event(
        'criteria.set',
        {
          criteria: [
            { id: 'c1', description: 'One', status: { type: 'pending' }, attempts: [] },
            { id: 'c2', description: 'Two', status: { type: 'pending' }, attempts: [] },
          ],
        },
        1000,
      ),
      event(
        'criteria.set',
        {
          criteria: [
            {
              id: 'c1',
              description: 'One',
              status: { type: 'completed', completedAt: '2024-01-02T03:04:05.000Z' },
              attempts: [],
            },
            {
              id: 'c2',
              description: 'Two',
              status: { type: 'passed', verifiedAt: '2024-01-03T03:04:05.000Z' },
              attempts: [],
            },
          ],
        },
        2000,
      ),
    ]
    expect(foldLastProgressAt(events)).toBe(new Date(2000).toISOString())
  })

  it('recognizes criteria metadata transitions but not unrelated metadata', () => {
    const events: EventLike[] = [
      event('metadata.set', { key: 'criteria', entries: [{ id: '0', description: 'One', status: 'pending' }] }, 1000),
      event(
        'metadata.set',
        { key: 'review_findings', entries: [{ id: '0', description: 'One', status: 'resolved' }] },
        2000,
      ),
      event('metadata.set', { key: 'criteria', entries: [{ id: '0', description: 'One', status: 'completed' }] }, 3000),
    ]
    expect(foldLastProgressAt(events)).toBe(new Date(3000).toISOString())
  })

  it.each([
    ['chat.done step_done', event('chat.done', { messageId: 'm1', reason: 'step_done' }, 2000)],
    [
      'workflow completed',
      event(
        'workflow.execution_changed',
        {
          executionId: 'e1',
          workflowId: 'w1',
          workflowName: 'Workflow',
          status: 'completed',
        },
        3000,
      ),
    ],
    [
      'task completed',
      event(
        'task.completed',
        {
          summary: null,
          iterations: 1,
          totalTimeSeconds: 1,
          totalToolCalls: 0,
          totalTokensGenerated: 0,
          avgGenerationSpeed: 0,
          responseCount: 1,
          llmCallCount: 1,
          criteria: [],
        },
        4000,
      ),
    ],
  ])('recognizes %s', (_name, progressEvent) => {
    expect(foldLastProgressAt([progressEvent])).toBe(new Date(progressEvent.timestamp!).toISOString())
  })

  it('does not treat failed, cancelled, waiting, or blocked signals as progress', () => {
    const events: EventLike[] = [
      event('phase.changed', { phase: 'waiting' }, 1000),
      event(
        'workflow.execution_changed',
        {
          executionId: 'e1',
          workflowId: 'w1',
          workflowName: 'Workflow',
          status: 'waiting',
        },
        2000,
      ),
      event('chat.done', { messageId: 'm1', reason: 'error' }, 2500),
      event('phase.changed', { phase: 'blocked' }, 3000),
      event(
        'workflow.execution_changed',
        {
          executionId: 'e1',
          workflowId: 'w1',
          workflowName: 'Workflow',
          status: 'blocked',
        },
        4000,
      ),
      event(
        'workflow.execution_changed',
        {
          executionId: 'e1',
          workflowId: 'w1',
          workflowName: 'Workflow',
          status: 'cancelled',
        },
        5000,
      ),
      event(
        'criterion.updated',
        {
          criterionId: 'c1',
          status: { type: 'failed', reason: 'Verification failed', failedAt: new Date(6000).toISOString() },
        },
        6000,
      ),
    ]
    expect(foldLastProgressAt(events)).toBeNull()
  })

  it('preserves progress through a snapshot and later activity', () => {
    const progress = '2024-01-02T03:04:05.000Z'
    const events: EventLike[] = [
      event('turn.snapshot', snapshot({ lastProgressAt: progress }), 5000),
      event('message.start', { messageId: 'm1', role: 'assistant' }, 6000),
    ]
    expect(foldLastProgressAt(events)).toBe(progress)
  })

  it('keeps the newest event timestamp after a snapshot', () => {
    const previousProgress = new Date(1000).toISOString()
    const events: EventLike[] = [
      event('turn.snapshot', snapshot({ lastProgressAt: previousProgress }), 5000),
      event('chat.done', { messageId: 'm1', reason: 'step_done' }, 6000),
      event('message.start', { messageId: 'm2', role: 'assistant' }, 7000),
    ]
    expect(foldLastProgressAt(events)).toBe(new Date(6000).toISOString())
  })

  it('recovers reliable criterion timestamps from legacy snapshots', () => {
    const criterionTimestamp = '2024-01-02T03:04:05.000Z'
    const legacy = snapshot({
      criteria: [
        {
          id: 'c1',
          description: 'One',
          status: { type: 'passed', verifiedAt: criterionTimestamp },
          attempts: [],
        },
      ],
    })
    expect(foldLastProgressAt([event('turn.snapshot', legacy, 5000)])).toBe(criterionTimestamp)
  })

  it('survives EventStore cleanup and reload from the persisted snapshot', () => {
    const db = new Database(':memory:')
    try {
      const store = new EventStore(db)
      const sessionId = 'session-1'
      store.append(sessionId, {
        type: 'session.initialized',
        data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
      })
      store.append(sessionId, { type: 'chat.done', data: { messageId: 'm1', reason: 'step_done' } })
      const sourceEvents = store.getEvents(sessionId)
      const progress = foldLastProgressAt(sourceEvents)
      const persistedSnapshot = buildSnapshotFromSessionState({
        session: { mode: 'builder', phase: 'build', isRunning: true, criteria: [] },
        events: sourceEvents,
        latestSeq: sourceEvents.at(-1)!.seq,
      })
      store.append(sessionId, { type: 'turn.snapshot', data: persistedSnapshot })
      store.append(sessionId, {
        type: 'message.start',
        data: { messageId: 'm2', role: 'assistant' },
      })

      store.cleanupOldEvents(sessionId)

      const reloaded = new EventStore(db)
      const { snapshot: persisted, events } = reloaded.getEventsSinceSnapshot(sessionId)
      const foldedEvents: EventLike[] = [
        ...(persisted ? [{ type: 'turn.snapshot' as const, data: persisted, timestamp: persisted.snapshotAt }] : []),
        ...events,
      ]
      expect(foldLastProgressAt(foldedEvents)).toBe(progress)
    } finally {
      db.close()
    }
  })

  it('persists folded progress in newly built snapshots', () => {
    const progress = '2024-01-02T03:04:05.000Z'
    const state = foldSessionState(
      [
        event('session.initialized', { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' }, 1000),
        event('chat.done', { messageId: 'm1', reason: 'step_done' }, Date.parse(progress)),
      ],
      'window-1',
      200000,
    )
    expect(buildSnapshot(state, 2, 3000).lastProgressAt).toBe(progress)
  })
})
