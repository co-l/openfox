# Bug: `Invalid string length` on long sessions (contextWindows overflow)

## Symptom

On a very long, active session the turn aborts with a non-recoverable chat error:

```
Chat error: Invalid string length recoverable: false
```

The session then becomes permanently broken: every subsequent turn fails the same
way, because the failure is deterministic (see root cause).

`Invalid string length` is V8's `RangeError`, thrown whenever a JavaScript string
would exceed the engine's hard maximum of **536 870 911 characters** (~512 MB).
It is not a logic bug in the usual sense — the string simply cannot exist. In this
case the string is the **JSON serialization of the end-of-turn snapshot**
(`EventStore.append` → `JSON.stringify(event.data)`).

## Evidence (session `bd86778a-e200-4a6a-a59d-78c93577105c`)

| Fact                            | Value                     |
| ------------------------------- | ------------------------- |
| Total event bytes               | ~858 MB                   |
| `turn.snapshot` rows            | 2, each ~429 MB           |
| Snapshot `contextWindows` field | 410 MB of the 429 MB      |
| `contextWindows` records        | **42 644**                |
| `contextState.compactionCount`  | **12**                    |
| Per-record `summary` (total)    | 398 MB (avg ~9.3 KB each) |
| Snapshot `messages` field       | 18 MB                     |

The decisive mismatch: **42 644 records for 12 real compactions**. The records
were being duplicated ~12 times (`42 644 / 12 ≈ 2^11.8`). The individual
`summary` sizes (~9 KB) are normal — the total is huge because of the _count_ of
copies, not their size.

## What a `turn.snapshot` is

OpenFox persists session state by event sourcing: every action (message, tool
call, compaction, …) is an immutable row in the `events` table. At the end of each
turn the server writes a `turn.snapshot` row — a full photo of the state
(display-window messages, criteria, context state, todos, metadata, **and** the
`contextWindows` / `formatRetries` history). Right after, `cleanupOldEvents`
deletes the raw events older than the snapshot, so the snapshot becomes the only
memory of the history. On the next turn, the fold re-seeds from the snapshot and
replays the post-snapshot events on top.

Consequence: **anything that grows inside a snapshot is re-serialized, on every
turn, forever.** A field that grows in the snapshot grows unboundedly with the
session's lifetime.

## Root cause

The overflow is the product of two independent defects that reinforce each other.

### 1. Non-idempotent re-seed (the amplifier)

`foldSessionState` re-seeds the `contextWindows` array from **every** snapshot it
finds in the event stream:

```ts
// before
case 'turn.snapshot': {
  if (Array.isArray(snapData.contextWindows) && snapData.contextWindows.length > 0) {
    contextWindows = [...snapData.contextWindows, ...contextWindows] // added per snapshot
  }
  ...
}
```

Normally only one snapshot survives in the raw store (cleanup removes the older
ones), so this is harmless. But when **more than one snapshot is present**, the
array is re-added once per snapshot — it grows by a factor of the number of
surviving snapshots **on every fold**.

### 2. Snapshot + cleanup were not atomic (the trigger)

The end-of-turn path ran two separate, non-transactional operations:

```ts
// before
const snapshotEvent = eventStore.append(sessionId, { type: 'turn.snapshot', data: snapshot })
const deletedCount = eventStore.cleanupOldEvents(sessionId)
```

Any crash/restart between the two (or a turn aborted mid-flight — the abort path
wrote a snapshot **without** cleaning up at all) left the **old** snapshot in the
table alongside the new one. From that point on, every fold re-seeded from both,
doubling the array; each new turn added a copy; and as the snapshot got bigger,
`JSON.parse`/`JSON.stringify` of a hundreds-of-MB payload consumed ever more heap —
making a crash before cleanup more likely. A self-amplifying avalanche:

```
12 → 25 → 50 → 100 → 200 → 400 → 800 → 1600 → 3200 → 6400 → 12800 → 25600 → 42 644
```

At ~429 MB the next `JSON.stringify` of the new snapshot crossed V8's max string
length → `Invalid string length`. Because the snapshot write failed, the cleanup
never ran, the raw events kept accumulating, and the next fold was even bigger —
so the failure is permanent, not a one-off.

### Why the `summary` was the dominant cost

Each `context.compacted` event carries an LLM-generated `summary` of the closed
window (~9 KB). The **functional** copy of that summary lives in the conversation
as an `isCompactionSummary` message — that is what the LLM actually reads as its
memory across compactions, and what the UI renders. The copy stored in
`contextWindows[].summary` is a redundant metadata duplicate that **no consumer
reads**:

- the snapshot→event reconstruction explicitly sets `summary: ''`
- the stats rollup's `CompactionEventRecord` has no `summary` field
- the client never receives `contextWindows` (it is not in the `session.state` WS
  payload; the context popover only uses `contextState`)

So 398 MB of the 410 MB `contextWindows` payload was dead weight.

## The fix

All changes are on the `fix_summary_overflow` branch, developed TDD (failing
reproduction tests first, then the fix).

### 1. Idempotent re-seed — `src/server/events/fold-state.ts`

The fold now re-seeds from the **latest** snapshot only (a stale older snapshot's
records are already subsumed by the newer one), then de-duplicates by full record
identity. Keying on `newWindowId` alone is not safe — a sub-agent compaction reuses
the parent's window pair — so the key is the composite of all identity fields
(`closedWindowId|newWindowId|beforeTokens|afterTokens|timestamp`), which removes
the verbatim duplicates without collapsing legitimate records. The same treatment
applies to `formatRetries`.

### 2. Atomic snapshot + cleanup — `src/server/events/store.ts`

New `appendSnapshotWithCleanup(sessionId, snapshot)` runs the snapshot append and
`cleanupOldEvents` in a single DB transaction. A serialization failure rolls back
everything, so the store is left exactly as it was and two snapshots can never
coexist. The end-of-turn path and the abort path both use it.
`truncateSessionMessages` uses the analogous `replaceEventsAfterSeqWithSnapshot`
(drop-after-seq + append + cleanup in one transaction).

### 3. Strip the dead `summary` — `src/server/events/fold-state.ts`

`normalizeSnapshotContextWindows` drops `summary` from every record before the
snapshot is persisted (`CompactionRecord.summary` is now optional). Each record
shrinks from ~9 KB to ~130 B.

### 4. Cap the array — `src/server/events/fold-state.ts`

`normalizeSnapshotContextWindows` also keeps only the most recent
`MAX_SNAPSHOT_CONTEXT_WINDOWS` (500) records. The authoritative total stays in
`contextState.compactionCount`. `getLegacyCompactionBaseline` (and the stats
rollup) now reports a count-only baseline + `compactionsDetailsAvailable: false`
when the array is capped, so the reported `compactionCount` stays exact even though
only the recent records are detailed. The snapshot is now bounded in size for any
session lifetime.

### 5. One-shot repair migration — `src/server/events/store.ts`

`migrateSnapshotContextWindows()` rewrites every persisted snapshot's
`contextWindows` in place (strip + dedupe + cap). It follows the existing
`migrateSnapshotStreams` safety model: a rollback backup is created before the
first rewrite, and it is idempotent via the `maintenance.snapshotContextWindowsMigratedV1`
settings flag. It runs automatically at server startup, so existing oversized
sessions (including `bd86778a…`) are repaired without sending another message.

## Verification

- Reproduction tests (fold with multiple snapshots, non-serializable snapshot,
  oversized snapshot) fail on the pre-fix code and pass after.
- `npm run test:unit` — full unit suite green (6015 tests).
- `npm run typecheck`, `npm run lint`, `npm run format` — green.

## Rollback

The migration keeps a `<db>.pre-context-windows.bak` backup (10-day retention) and
is idempotent. To revert the code, remove the `fix_summary_overflow` changes; to
revert a migrated database, restore the `.bak`.
