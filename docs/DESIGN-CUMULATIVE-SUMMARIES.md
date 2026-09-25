# Cumulative Compaction Summaries — Design

> Stored, rolling cumulative summaries. One boolean config, one pure merge,
> zero runtime projection.

## Problem

Each compaction replaces the context window with a seed summary generated
**from the previous seed summary** (recursive summarization). Details from early
rounds are progressively diluted: by round N the model only sees the distillation
of the distillation of round 1.

## Solution

When the feature is on, the new window's seed summary is stored as the
**previous window's stored seed** plus a dated marker and the fresh LLM summary
(oldest first). Because every stored seed already contains the full history, a
single append is the cumulative digest:

```
window 2 seed:  ## Compacted 2024-01-16T10:00:00.000Z
                S1

window 3 seed:  ## Compacted 2024-01-16T10:00:00.000Z
                S1

                ## Compacted 2024-01-16T18:30:00.000Z
                S2

window 4 seed:  ...S1...S2...

                ## Compacted 2024-01-17T09:15:00.000Z
                S3
```

The stored seed is **exactly what the LLM receives** — the content is computed
once at compaction time and never re-projected. Reading a session never
consults the feature config.

## Config

`context.allCompactionSummaries: boolean` (default `false`) in the global config
file. No per-event or snapshot persistence: the `context.compacted` event carries
the stored (merged) `summary` for debugging, but nothing at read time depends on
a stored decision.

| File                  | Change                                          |
| --------------------- | ----------------------------------------------- |
| `src/shared/types.ts` | `Config.context.allCompactionSummaries?`        |
| `src/cli/config.ts`   | `context` block in the global config schema     |
| `src/cli/serve.ts`    | merge global config `context` over env defaults |

## Implementation

| File                                    | Change                                                                                                                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/chat/cumulative-summary.ts` | pure `mergeSummaryInto(llmSummary, previousMerged?, timestamp?)` and `findWindowSummary(messages, windowId)`                                                                                                         |
| `src/server/chat/agent-loop.ts`         | compaction tail: when on (and top-level), `storedSummary = mergeSummaryInto(summary, findWindowSummary(fold(events), closedWindowId))`; stored in both `context.compacted.data.summary` and the seed `message.start` |
| `src/server/chat/orchestrator.ts`       | wires `getEvents` into the loop config (the loop never imports the EventStore)                                                                                                                                       |
| `src/server/chat/prompts.ts`            | `COMPACTION_PROMPT` gains an anti-imitation guard: the cumulative seed's `## Compacted` sections are history — the LLM must summarize only this round and not reproduce the layout or re-list earlier summaries      |

Both compaction paths (auto via threshold, manual via `initialCompacting`) run
the same tail, so both are covered.

### Finding the previous seed

`findWindowSummary` scans the **folded** cross-window message list
(`foldTurnEventsToSnapshotMessages`) for the closed window's top-level
`isCompactionSummary` message. Folding is snapshot-aware, so the lookup
survives `cleanupOldEvents` GC of pre-snapshot events. One fold per compaction
— negligible (compaction is rare, not per-request).

### Edge cases

- First compaction (no prior seed) → `## Compacted <ts>\nS1`
- Feature off → bare `S1` (byte-identical to baseline behavior)
- Sub-agent compaction → bare summary, never merges (top-level only)
- Empty summary → existing error path, unchanged
- Toggling off after merging → new windows get bare seeds; previously stored
  merged seeds are frozen (no rewrite, no migration)

## Deliberate tradeoffs

- **Frozen at compaction time.** Changing the config only affects later
  compactions. Accepted: the stored content is the source of truth and must
  stay stable for KV-cache and replay.
- **Quadratic storage.** Seed N stores N-1 prior summaries verbatim; total
  stored text grows O(N²) across rounds. Prompt size is the same as any
  cumulative design (the model must see the history). Sessions rarely exceed
  a few compactions.
- **No k-truncation.** All-or-nothing by design — a cap would reintroduce
  selection logic without changing the storage model.
- **Transparency for free.** The merged text lives in the seed message, so the
  transcript card shows exactly what the model saw. No separate digest card,
  no UI changes.

## Why not runtime projection

An earlier iteration projected the prior-rounds digest into the summary at
request-build time. It honored config changes at read time but moved the
digest out of the event log (the prompt contained content the DB did not) and
added per-request invariants (round numbering, current-window exclusion,
snapshot-replay parity, double-fold avoidance) that every context build had to
uphold. The stored rolling append keeps the prompt a pure function of stored
events and reduces the feature to one concatenation at compaction time.

## Tests

- `cumulative-summary.test.ts` — `mergeSummaryInto` (first round, append,
  multi-round accumulation, empty previous, timestamp default) and
  `findWindowSummary` (hit, first window, sub-agent exclusion, unknown window)
- `agent-loop.test.ts` › `runTopLevelAgentLoop cumulative summaries` — stored
  seed content asserted for: off (bare), on first compaction (marker), on
  second compaction (previous seed + marker + fresh), sub-agent (no merge);
  `context.compacted.data.summary` always equals the stored seed
