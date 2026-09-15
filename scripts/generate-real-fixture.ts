/**
 * One-off generator for the real-data conversation-tree performance fixture.
 *
 * Reads a READ-ONLY sqlite .backup copy of a production OpenFox database
 * (NEVER the live database), extracts one large pre-v3 (linear + snapshot +
 * chunk) session, and rewrites it as an ordered list of turn events that the
 * v3 event store's normal append path can replay. Replaying through append()
 * exercises the real production write path: chunk merging into single
 * message nodes, blob externalization, cursor chaining.
 *
 * The generator DROPS v1-only persistence artifacts (turn.snapshot,
 * tool.preparing, tool.output) and trims unbounded streams so the fixture
 * stays ~5MB:
 *   - message.thinking: max 2 chunks per message, 8KB total
 *   - message.delta: max 3 chunks per message
 *   - message.done stats.llmCalls: capped at 3 entries
 *   - tool.result: payloads capped at 2KB
 *
 * Usage:
 *   sqlite3 <live-db> ".backup /tmp/px-backup.db"   # consistent, safe copy
 *   npx tsx scripts/generate-real-fixture.ts /tmp/px-backup.db \
 *     d9aaa677-1347-47ff-9138-19444619b747 e2e/fixtures/real-session.json
 *
 * The fixture is data, not code under test — regeneration is allowed and
 * expected across releases.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'

const [backupPath, sessionId, outPath] = process.argv.slice(2)
if (!backupPath || !sessionId || !outPath) {
  console.error('Usage: generate-real-fixture.ts <backup-db> <session-id> <out.json>')
  process.exit(1)
}

const db = new Database(resolve(backupPath), { readonly: true })

const MAX_THINKING_CHUNKS_PER_MESSAGE = 2
const MAX_THINKING_BYTES_PER_MESSAGE = 8 * 1024
const MAX_DELTA_CHUNKS_PER_MESSAGE = 3
const MAX_TOOL_RESULT_BYTES = 2 * 1024
const MAX_LLM_CALLS = 3

/** v1 persistence artifacts with no v3 equivalent. */
const DROPPED_TYPES = new Set(['turn.snapshot', 'tool.preparing', 'tool.output'])

interface V1Event {
  seq: number
  timestamp: number
  event_type: string
  payload: string
}

const rows = db
  .prepare('SELECT seq, timestamp, event_type, payload FROM events WHERE session_id = ? ORDER BY seq')
  .all(sessionId) as V1Event[]

if (rows.length === 0) {
  console.error(`No events found for session ${sessionId}`)
  process.exit(1)
}

const v1Bytes = rows.reduce((sum, r) => sum + r.payload.length, 0)

interface FixtureEvent {
  seq: number
  timestamp: number
  type: string
  data: Record<string, unknown>
}

const fixture: FixtureEvent[] = []
const dropped = new Map<string, number>()
let chunkTrimmed = 0
let resultCapped = 0

const thinkingBudget = new Map<string, number>()
const deltaCount = new Map<string, number>()
for (const row of rows) {
  if (DROPPED_TYPES.has(row.event_type)) {
    dropped.set(row.event_type, (dropped.get(row.event_type) ?? 0) + 1)
    continue
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(row.payload) as Record<string, unknown>
  } catch {
    dropped.set(row.event_type, (dropped.get(row.event_type) ?? 0) + 1)
    continue
  }

  if (row.event_type === 'message.thinking') {
    const messageId = String(data['messageId'] ?? '?')
    const content = typeof data['content'] === 'string' ? (data['content'] as string) : ''
    const used = thinkingBudget.get(messageId) ?? 0
    const usedChunks = (used >> 24) >>> 0 // high byte: chunk count (max 2)
    if (usedChunks >= MAX_THINKING_CHUNKS_PER_MESSAGE || used + content.length > MAX_THINKING_BYTES_PER_MESSAGE) {
      chunkTrimmed += 1
      continue
    }
    thinkingBudget.set(messageId, ((usedChunks + 1) << 24) | ((used + content.length) & 0xffffff))
  }

  if (row.event_type === 'message.delta') {
    const messageId = String(data['messageId'] ?? '?')
    const count = (deltaCount.get(messageId) ?? 0) + 1
    deltaCount.set(messageId, count)
    if (count > MAX_DELTA_CHUNKS_PER_MESSAGE) {
      chunkTrimmed += 1 // reused counter: unbounded chunk stream trimmed
      continue
    }
  }

  // v1 persisted per-LLM-call stats on message.done — unbounded in long
  // agent turns. Keep shape, cap the array.
  const stats = data['stats'] as { llmCalls?: unknown[] } | undefined
  if (stats && Array.isArray(stats.llmCalls) && stats.llmCalls.length > MAX_LLM_CALLS) {
    stats.llmCalls = stats.llmCalls.slice(0, MAX_LLM_CALLS)
  }

  if (row.event_type === 'tool.result') {
    const raw = JSON.stringify(data)
    if (Buffer.byteLength(raw, 'utf8') > MAX_TOOL_RESULT_BYTES) {
      const result = data['result'] as { output?: string; error?: string } | undefined
      if (result && typeof result.output === 'string' && result.output.length > 400) {
        result.output = result.output.slice(0, 400) + '…[fixture-trimmed]'
        data['result'] = result
        resultCapped += 1
      }
    }
  }

  fixture.push({ seq: row.seq, timestamp: row.timestamp, type: row.event_type, data })
}

const fixtureBytes = fixture.reduce((sum, e) => sum + JSON.stringify(e.data).length + 32, 0)

mkdirSync(dirname(resolve(outPath)), { recursive: true })
const json = JSON.stringify(fixture)
writeFileSync(resolve(outPath), json)

const typeCounts = new Map<string, number>()
for (const e of fixture) typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1)

console.log('=== Real-data fixture generation (v1 → v3 replay) ===')
console.log(`Source backup (read-only): ${resolve(backupPath)}`)
console.log(`Session: ${sessionId}`)
console.log(`v1: ${rows.length} events, ${(v1Bytes / 1024 / 1024).toFixed(2)}MB payloads`)
console.log(`Dropped v1-only types: ${[...dropped.entries()].map(([t, n]) => `${t}×${n}`).join(', ') || 'none'}`)
console.log(`Chunks trimmed: ${chunkTrimmed}, tool.results capped: ${resultCapped}`)
console.log(
  `Fixture: ${fixture.length} events, ${(fixtureBytes / 1024 / 1024).toFixed(2)}MB (disk: ${(json.length / 1024 / 1024).toFixed(2)}MB)`,
)
console.log(
  `Types: ${[...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}×${n}`)
    .join(', ')}`,
)
console.log(`Messages in fixture: ${typeCounts.get('message.start') ?? 0} (→ merged message nodes after replay)`)
const v2NodeEstimate =
  (typeCounts.get('message.start') ?? 0) +
  (typeCounts.get('tool.result') ?? 0) +
  [...typeCounts.entries()]
    .filter(([t]) => !t.startsWith('message.') && t !== 'tool.call')
    .reduce((s, [, n]) => s + n, 0)
console.log(`Estimated v3 nodes after merge: ~${v2NodeEstimate}`)
console.log(
  `Compression: ${(100 - (fixtureBytes / v1Bytes) * 100).toFixed(1)}% smaller on the wire; v3 storage ≈ ${(fixtureBytes / 1024 / 1024).toFixed(2)}MB (post-externalization rows are smaller)`,
)
console.log(`Wrote: ${resolve(outPath)}`)

db.close()
