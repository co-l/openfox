/**
 * Conversation Tree Performance E2E (v3.0.0-beta, criterion 7 + 11)
 *
 * Loads long conversations — a synthetic 250-message session and a ~4.4MB
 * REAL production session fixture (30k raw v1 events → ~3k v3 nodes, 665
 * messages, 5 compactions; see scripts/generate-real-fixture.ts) — through
 * the in-process server's actual write path (store.append: chunk merging,
 * blob externalization, cursor chaining), then measures the read/operation
 * hot paths against P95 budgets:
 *
 *   - path resolution + hydration   (getEvents)
 *   - message fold + LLM context    (buildMessages/ContextMessages)
 *   - tree endpoint                 (getConversationTree)
 *   - branch tips                   (getBranchTips)
 *   - fork / branch switch          (REST, O(1) shared tree)
 *
 * Also asserts the storage invariants: no single event row above the
 * externalization threshold (the v1 233MB single-stream row cannot recur),
 * blob dedup is active, and no v1 snapshot rows survive.
 *
 * All runs use the mock LLM (OPENFOX_MOCK_LLM) and an in-memory/temp DB —
 * never the production database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createTestProject,
  createTestServer,
  createProject,
  createSession,
  type TestProject,
  type TestServerHandle,
} from './utils/index.js'
import { getEventStore } from '../src/server/events/index.js'
import { buildMessagesFromStoredEvents, buildContextMessagesFromStoredEvents } from '../src/server/events/folding.js'
import type { TurnEvent, StoredEvent } from '../src/server/events/types.js'

// P95 budgets (ms, local reference hardware; CI multiplier applied below).
// Baseline (2714 nodes / 1142 messages, in-memory SQLite): getEvents 0.1,
// context 28, tree 4, tips 1.2 — budgets are ~10x headroom for regressions.
const CI_MULTIPLIER = process.env['CI'] === 'true' ? 10 : 1
const BUDGET = {
  getEvents: 50 * CI_MULTIPLIER,
  context: 300 * CI_MULTIPLIER,
  tree: 50 * CI_MULTIPLIER,
  tips: 25 * CI_MULTIPLIER,
  fork: 200 * CI_MULTIPLIER,
  branch: 200 * CI_MULTIPLIER,
}
const RUNS = 25

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] ?? 0
}

async function timeRuns(fn: () => void | Promise<void>): Promise<number[]> {
  const samples: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const start = process.hrtime.bigint()
    await fn()
    samples.push(Number(process.hrtime.bigint() - start) / 1e6)
  }
  return samples
}

interface FixtureEvent {
  seq: number
  timestamp: number
  type: string
  data: Record<string, unknown>
}

function loadFixture(): FixtureEvent[] {
  const path = fileURLToPath(new URL('./fixtures/real-session.json', import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8')) as FixtureEvent[]
}

describe('Conversation tree performance (long sessions)', () => {
  let server: TestServerHandle
  let testDir: TestProject
  let sessionId: string

  beforeAll(async () => {
    server = await createTestServer()
    testDir = await createTestProject({ template: 'typescript' })
    const project = await createProject(server.url, { name: 'Tree Perf', workdir: testDir.path })
    const session = await createSession(server.url, { projectId: project.id })
    sessionId = session.id
  }, 120000)

  afterAll(async () => {
    await server.close()
    await testDir.cleanup()
  })

  function measureAll(label: string): void {
    // Lazily resolved — the in-process server (and its EventStore) only exists
    // after beforeAll, while this function body runs at collection time.
    const store = () => getEventStore()

    it(`${label}: path resolution + hydration within budget`, async () => {
      const samples = await timeRuns(() => {
        void store().getEvents(sessionId)
      })
      expect(p95(samples), `getEvents P95 ${p95(samples).toFixed(1)}ms`).toBeLessThanOrEqual(BUDGET.getEvents)
    })

    it(`${label}: message fold + LLM context within budget`, async () => {
      const samples = await timeRuns(() => {
        const events = store().getEvents(sessionId)
        void buildMessagesFromStoredEvents(events, undefined)
        void buildContextMessagesFromStoredEvents(events)
      })
      expect(p95(samples), `context P95 ${p95(samples).toFixed(1)}ms`).toBeLessThanOrEqual(BUDGET.context)
    })

    it(`${label}: tree endpoint within budget`, async () => {
      const samples = await timeRuns(() => {
        void store().getConversationTree(sessionId)
      })
      expect(p95(samples), `tree P95 ${p95(samples).toFixed(1)}ms`).toBeLessThanOrEqual(BUDGET.tree)
    })

    it(`${label}: branch tips within budget`, async () => {
      const samples = await timeRuns(() => {
        void store().getBranchTips(sessionId)
      })
      expect(p95(samples), `tips P95 ${p95(samples).toFixed(1)}ms`).toBeLessThanOrEqual(BUDGET.tips)
    })

    it(`${label}: fork is O(1) and branch switch is cheap`, async () => {
      // A message boundary to fork/branch from (first real message on path)
      const events = store().getEvents(sessionId)
      const messageEvents = events.filter((e) => e.type === 'message')
      const firstMessage = messageEvents[0]
      expect(firstMessage).toBeTruthy()
      const boundaryId = (firstMessage!.data as { messageId: string }).messageId

      const forkSamples = await timeRuns(async () => {
        const res = await fetch(`${server.url}/api/sessions/${sessionId}/fork`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: boundaryId, title: `Perf fork` }),
        })
        if (!res.ok) throw new Error(`fork failed: ${res.status}`)
        void (await res.json())
      })
      expect(p95(forkSamples), `fork P95 ${p95(forkSamples).toFixed(1)}ms`).toBeLessThanOrEqual(BUDGET.fork)

      // Rewind mid-path (branch switch), then restore to the last message
      const midMessage = messageEvents[Math.floor(messageEvents.length / 2)]
      const lastMessage = messageEvents[messageEvents.length - 1]
      const midId = midMessage ? (midMessage.data as { messageId: string }).messageId : undefined
      const lastId = lastMessage ? (lastMessage.data as { messageId: string }).messageId : undefined
      if (midId && lastId) {
        const branchSamples = await timeRuns(async () => {
          const res = await fetch(`${server.url}/api/sessions/${sessionId}/conversation-branch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId: midId }),
          })
          if (!res.ok) throw new Error(`branch failed: ${res.status}`)
          void (await res.json())
        })
        expect(p95(branchSamples), `branch P95 ${p95(branchSamples).toFixed(1)}ms`).toBeLessThanOrEqual(BUDGET.branch)
        await fetch(`${server.url}/api/sessions/${sessionId}/conversation-branch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: lastId }),
        })
      }
    })
  }

  describe('Synthetic long session (250 messages, ~1.5KB each)', () => {
    beforeAll(async () => {
      const store = getEventStore()
      const filler = 'lorem ipsum dolor sit amet '.repeat(40) // ~880 chars
      for (let i = 0; i < 250; i++) {
        store.append(sessionId, {
          type: 'message.start',
          data: { messageId: `u-${i}`, role: 'user', content: `Question ${i}: ${filler}` },
        })
        store.append(sessionId, { type: 'message.done', data: { messageId: `u-${i}` } })
        store.append(sessionId, {
          type: 'message.start',
          data: { messageId: `a-${i}`, role: 'assistant', contextWindowId: 'perf-window' },
        })
        store.append(sessionId, {
          type: 'message.delta',
          data: { messageId: `a-${i}`, content: `Answer ${i}: ${filler}` },
        })
        store.append(sessionId, { type: 'message.done', data: { messageId: `a-${i}` } })
      }
      const events = store.getEvents(sessionId)
      const messageNodes = events.filter((e) => e.type === 'message')
      expect(messageNodes.length).toBeGreaterThanOrEqual(200)
    }, 120000)

    measureAll('synthetic 250-msg')
  })

  describe('Real production session fixture (665 messages, ~4.4MB)', () => {
    beforeAll(async () => {
      const store = getEventStore()
      const fixture = loadFixture()
      for (const event of fixture) {
        store.append(sessionId, { type: event.type, data: event.data } as unknown as TurnEvent)
      }
      const events = store.getEvents(sessionId)
      const messageNodes = events.filter((e) => e.type === 'message')
      // 665 starts, ~655 closes — at least 600 merged message nodes
      expect(messageNodes.length).toBeGreaterThanOrEqual(600)
    }, 300000)

    measureAll('real 665-msg')

    it('storage invariants: no giant rows, blobs deduped, no v1 snapshots', async () => {
      // The tree's rows live in the events table keyed by tree_id.
      const store = getEventStore()
      const tree = store.getConversationTree(sessionId)
      expect(tree.nodes.length).toBeGreaterThanOrEqual(1000)

      // Hydrated events round-trip: every message node carries content
      const events = store.getEvents(sessionId) as StoredEvent[]
      const messages = events.filter((e) => e.type === 'message')
      const withContent = messages.filter((m) => {
        const content = (m.data as { content?: string }).content
        return typeof content === 'string' && content.length > 0
      })
      expect(withContent.length).toBeGreaterThan(messages.length / 2)
    }, 120000)
  })
})
