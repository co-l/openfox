# DESIGN: Cumulative Compaction Summaries

Status: Implemented (develop, 2026-09-19)
Date: 2026-09-19

## Motivation

When a session's context is compacted, a new context window starts with a single
seed summary — the LLM-generated summary of the window being closed
(`agent-loop.ts`, compaction tail). Two properties of today's behavior motivate
this design:

1. **Recursive summarization only.** Each new summary is generated _from_ the
   previous summary (it is the first message of its window), so older rounds
   survive only as an ever-more-compressed condensation. The per-round
   summaries themselves are no longer visible to the model, or to a reader of
   the transcript.
2. **No round metadata reaches the LLM.** `isCompactionSummary` /
   `contextWindowId` are stripped before the request is built
   (`conversation-history.ts`), and the system prompt carries no window/round
   information. The model cannot tell which round a summary covers, or how many
   rounds have been compacted.

**Goal:** at the start of round N, optionally inject the summaries of previous
rounds (1..N-1), labeled with their round numbers, so the model sees the full
per-round history instead of a single condensed summary.

## Goals / Non-goals

**Goals**

- Opt-in via config: `context.digestRound` (default `0` = today's behavior).
- The _decision_ is recorded in the event log at decision time → deterministic
  replay, per-round auditable.
- Digest content is a **pure projection** of persisted messages — idempotent,
  no rolling state.
- Zero change to the default path: with `digestRound = 0`, the LLM request is
  byte-identical to today.
- Survives snapshot + `cleanupOldEvents` purge and server restart.

**Non-goals (v1)**

- Sub-agent scopes (top-level window only).
- Re-injecting compacted tool results / file content (summaries only).
- Per-model override of the digest setting (global config only).
- **Digest size cap.** `digestRound = -1` embeds every prior seed summary
  verbatim with no token budget: in long sessions with many compactions the
  digest can occupy a large fraction of the fresh window and re-trigger
  compaction shortly after rotation (thrash), partially defeating it.
  `k` is the escape hatch; a token-budget cap is a possible enhancement.

## Current behavior (baseline)

- One LLM call per round; compaction is a mode _inside_ the agent loop, not a
  new session.
- Auto-compaction: threshold check (`compactor.ts:shouldCompact`, hard ceiling
  95% / 5K headroom) runs **before** tool execution; on trigger,
  `appendCompactionPrompt` (visible `auto-prompt` user message) is appended and
  the next iteration summarizes.
- Summary generation is ordinary streaming: `message.start` (deferred to first
  chunk) + `message.thinking`/`message.delta` × n, all tagged to the _closing_
  window.
- Tail (single emission site, `agent-loop.ts:801`): `context.compacted
{closedWindowId, newWindowId, beforeTokens, afterTokens, summary}` →
  second `message.start` with the **same messageId** (upsert relocates the
  message into the new window, replaces streamed partial with the full summary,
  sets `isCompactionSummary`) → `message.done`/`chat.done` → agent reminder
  re-injected into the new window → `rebuildCachedContext`.
- LLM context for the new window: `buildContextMessagesFromStoredEvents` filters
  `message.start` by `contextWindowId === currentWindowId` — old-window messages
  (and old summaries) are excluded.
- `foldContextState` flips `currentContextWindowId` / increments
  `compactionCount` on `context.compacted`.
- `cleanupOldEvents` retains: `session.initialized` (seq 1), all `turn.snapshot`
  events, whitelisted state events (`criteria.set`, `criterion.updated`,
  `mode.changed`, `phase.changed`, `todo.updated`, `context.state`,
  `metadata.set`), and post-snapshot events. **`context.compacted` is not
  whitelisted** → compaction records (window chain, per-round summaries, token
  stats) are deleted after the next snapshot + cleanup.
- Snapshot messages are cumulative across windows (retain `contextWindowId` /
  `isCompactionSummary` tags) → the message list is the purge-robust source of
  round structure.
- Sub-agent compaction reuses the same event type (type allows
  `subAgentId`/`subAgentType`); the sub-agent context fold
  (`buildSubAgentContextMessages`) anchors on the most recent
  `context.compacted` with matching `subAgentId` — no window filter.

## Design

### 1. Decision: `digestRound`, stamped on every compaction

| Value   | Meaning                                                                                       |
| ------- | --------------------------------------------------------------------------------------------- |
| `0`     | **Current behavior** — no history injection. Default. Old sessions/events read as 0 (`?? 0`). |
| `k ≥ 1` | Cap — inject the most recent `k` prior-round summaries; older ones dropped.                   |
| `-1`    | Full — inject every prior-round summary; nothing truncated.                                   |

- Stamped into `context.compacted` event data (`digestRound?: number`). The
  event is emitted exactly once per compaction (single emission site), so the
  decision log is complete **including the 0 rounds** — every compaction
  records what was in effect at that moment. Replay is fully deterministic;
  no read-time inference from mutable config.
- Mirrored into `SessionSnapshot.digestRound` (latest-wins fold, same mechanism
  as `currentContextWindowId`) so the decision survives purge and restart.

**Why on the event, not as a persisted message:** a persisted "0" message would
enter the LLM context and the transcript. The decision is state, not
conversation; the event stream is the right home.

### 2. Payload: the digest message (only when `digestRound !== 0`)

Emitted in the compaction tail, after `context.compacted`:

- `message.start`: role `user`, `isSystemGenerated`, `messageKind:
'auto-prompt'`, `metadata: { type: 'compaction-digest', round, name, color,
entries }`, `contextWindowId: newWindowId`, content = rendered digest.
- `message.done`.

`entries` is the **machine-readable** twin of the content:
`Array<{ round: number; windowId: string; messageId: string; summarizedAt: string }>`
(round's own window id; the seed message's id; ISO-8601 UTC time the summary
was written). It exists so UI tooltips / debugging / idempotent re-rendering
never have to parse the markdown content. Timestamp source: the seed
message's `Message.timestamp` (a required, snapshot-persisted field) —
`summarizedAt` mirrors it; `messageId` is the join key back to the verbatim
summary text.

### 2a. Composition format — where / when / what

Numbering convention (fixed once, used everywhere):

- Round N = window N (window 1 = the initial window).
- The summary stored in window N **describes round N-1** (it was generated
  when window N-1 closed). It is the seed of window N.
- In window N, the LLM is working in round N; the digest lists rounds
  1..N-2; the seed (following message) summarizes round N-1.

| Element                         | Where                                         | When injected                                             | Format                                                                                                                                    |
| ------------------------------- | --------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Preamble                        | digest content, line 1–2                      | at emission (compaction tail), fixed for the whole window | see template                                                                                                                              |
| Truncation note                 | digest content, after preamble                | at emission, **only when** `round = k` drops older rounds | `Note: only the most recent k round summaries are included below; earlier rounds were omitted.`                                           |
| Round header                    | digest content, per round                     | at emission                                               | `## Round N — summarized <ISO-8601 UTC ts>` (past participle, git-log `authored <ts>` style)                                              |
| Round header (machine-readable) | digest `metadata.entries`                     | at emission                                               | `{ round, windowId, messageId, summarizedAt }` per round — mirrors the content headers; timestamp = seed message's `Message.timestamp`    |
| Round body                      | digest content                                | at emission                                               | the stored summary text **verbatim** (never re-compressed or edited)                                                                      |
| Divider between rounds          | digest content                                | at emission                                               | single blank line — the `## Round N` header _is_ the divider; no `---`                                                                    |
| Seed pointer                    | digest content, last line                     | at emission                                               | `The message immediately after this one is the compaction summary of Round N-1 (the round that was just compacted). Continue from there.` |
| Seed summary itself             | **untouched** (persisted historical artifact) | never                                                     | raw LLM text as generated; its round identity is conveyed by the seed-pointer line, never by rewriting it                                 |

Rendering is done **once, at emission** (projection, §3) — never at request
build time. Labels/timestamps are fixed for the life of the window → stable
KV-cache prefix. Timestamp source: the summary message's own timestamp (the
moment that round was closed).

**Edge rule:** zero rounds to list (first compaction, or `round = k` with
k ≥ available count and nothing to add beyond none) → **no digest message is
emitted at all**, even in non-0 modes. The window then has exactly today's
shape (`[system, seed, reminder]`).

Full example — window 4, `digestRound = -1` (three rounds compacted so far):

```
Earlier parts of this conversation were compacted to save context.
Below are the compaction summaries of the previous rounds, oldest first.

## Round 1 — summarized 2026-09-19T09:14:03Z
<summary message of window 2, verbatim>

## Round 2 — summarized 2026-09-19T11:47:26Z
<summary message of window 3, verbatim>

The message immediately after this one is the compaction summary of Round 3
(the round that was just compacted). Continue from there.
```

`metadata.entries` for the same digest: `[{round:1, windowId:W1,
messageId:M2, summarizedAt:2026-09-19T09:14:03Z}, {round:2, windowId:W2,
messageId:M3, summarizedAt:2026-09-19T11:47:26Z}]` (M2/M3 = the seed messages in
windows 2/3).

Resulting LLM message list for window 4:

```
[system]    rebuilt system prompt
[user]      digest (above)
[assistant] seed — Round 3 summary, raw
[user]      agent reminder
[user]      next user prompt
```

Same window with `digestRound = 1` (capped — Round 1 dropped):

```
Earlier parts of this conversation were compacted to save context.
Note: only the most recent 1 round summaries are included below; earlier
rounds were omitted.

## Round 2 — summarized 2026-09-19T11:47:26Z
<summary message of window 3, verbatim>

The message immediately after this one is the compaction summary of Round 3
(the round that was just compacted). Continue from there.
```

Message properties:

- Role `user`: system scaffolding, not an assistant utterance; avoids
  consecutive-assistant-message rejection on some backends.
- Single message (not N): stable KV-cache prefix within a window; trivially
  renderable as one card in the UI.
- The digest is an **ordinary in-window message** → the canonical context fold
  includes it with zero special-casing, and sub-agent scopes (which filter by
  `subAgentId`) automatically exclude it.

### 2b. Compaction prompt hardening (anti-imitation)

Once digests exist, the _next_ compaction's LLM sees a digest message in its
context — a visually distinctive scaffold (preamble, `## Round N — summarized
<ts>` headers, seed-pointer line). Without an explicit instruction, the model
may imitate that format when producing the new summary (emitting its own round
headers / preamble / pointer text), polluting the seed summary and — by
induction — every later digest.

`COMPACTION_PROMPT` gains an unconditional guard paragraph (compaction turns
are rare; the few extra tokens are negligible; the tool-call-rejection retry
variant embeds `COMPACTION_PROMPT`, so it inherits the guard):

```
The conversation may contain a system-generated "compaction digest" message
with a preamble and "## Round N — summarized ..." sections. That message is
scaffolding describing PREVIOUS rounds — it is not part of this round's
conversation. Your output must be the plain structured summary of THIS
conversation only: do not reproduce, continue, or imitate the digest's
preamble, round headers, timestamps, or closing pointer lines, and do not
re-list previous rounds' summaries. If you mention the compaction at all, say
in a single line that earlier rounds were compacted — without quoting them.
```

The seed summary stays in the existing 8-point structured-summary shape; the
digest's format is reserved for the system, never for model output.

### 3. Content is a pure projection (no rolling state)

The digest is rebuilt from scratch at every compaction:

1. Collect every `isCompactionSummary` message across all windows. Snapshot
   messages are cumulative, so this survives purge/restart. (Round N's summary
   lives in window N+1.)
2. Number rounds: window 1 = `session.initialized.contextWindowId`; round N =
   order of first appearance of each distinct `contextWindowId` in message
   order (fallback `'legacy-window-1'` for pre-feature sessions). The
   `context.compacted` chain is an equivalent source when those events
   survive, but messages are the robust one.
3. Select per `digestRound`: `-1` → all prior rounds; `k` → most recent `k`.
4. Render with `## Round N` headers (timestamps from the summary messages).

Idempotent: any round's digest is a pure function of the message set + the
decision — no "read the previous digest" chain, no monotone information loss
beyond the explicit cap.

### 4. Fold / snapshot changes

- `foldContextState` and `foldSessionState`: track `digestRound` (latest-wins).
- `buildSnapshotFromSessionState`: include `digestRound` in the returned
  `SessionSnapshot`.
- `buildSnapshotFromSessionState`: include `contextWindows`
  (`CompactionRecord[]`) — closes an existing gap: the field is declared in
  `SessionSnapshot` and folded, but never written into the snapshot, so the
  data is lost after purge.
- No change to `buildContextMessagesFromStoredEvents` (see §2).

### 5. Config

`context.digestRound: number` (default `0`) in the global config schema
(`shared/types.ts` + `config.ts`), resolved **at compaction time**; a change
takes effect at the next compaction.

Mode-switching semantics:

- `on → off`: no further digests. An existing digest stays in its (now
  closing) window and falls out of the LLM context at the next rotation —
  natural decay, no active deletion.
- `off → on`: decision history reads `0` → the first digest covers the full
  available history per the chosen mode.

### 6. UI

- `AutoPromptCard`: new `type: 'compaction-digest'` label (en/fr) + dot color;
  content shown in the existing expandable modal, like `compaction`.
- **Decision: no header badge in v1** (mode visibility comes from the card
  itself); the `snapshot.digestRound` field still exists for a future badge.

## Compatibility

- Old events: no `digestRound` → `?? 0`.
- Old snapshots: same.
- Old clients: unknown event fields / metadata types are ignored
  (`AutoPromptCard` falls back to the "injected" label).
- Default mode: no digest message emitted; LLM request unchanged.

## Known adjacent issues (found while designing)

1. **Sub-agent compaction rotates the top-level window.** `foldContextState`
   applies `context.compacted` without checking `subAgentId`, and the sole
   emission site does not stamp `subAgentId` on the event (the type allows it).
   **Decision: separate PR.** This change is unaffected by the bug: the digest
   is emitted in the same tail as the seed summary and inherits exactly the
   same (buggy) window behavior — no new inconsistency is introduced. The
   `digestRound` stamp on a sub-agent compaction event carries the same global
   config value, so the latest-wins fold is not polluted. Once the rotation bug
   is fixed separately, the digest becomes correct automatically.
2. `emitContextCompacted` (`events/session.ts`) is exported but never called —
   dead code. **Decision: leave as-is** (avoid widening the change surface);
   this change keeps the inline `append` in the agent loop.
3. `ContextWindow` (`shared/types.ts`) with `sequenceNumber` is a dead type
   (`Session.contextWindows` is always `[]`). Round derivation per §3 makes
   per-window data available; type cleanup is out of scope.

## Decisions log (reviewed interactively, 2026-09-19)

| #   | Question                                                                                   | Decision                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scope: top-level only, or include sub-agent scopes?                                        | **Top-level only** for v1                                                                                                                                                                                                                                            |
| 2   | Sub-agent compaction rotates top-level window (pre-existing bug) — fix here or separately? | **Separate PR**; digest inherits the same tail/window behavior as the seed summary, so no new inconsistency                                                                                                                                                          |
| 3   | Dead `emitContextCompacted` helper — delete, adopt, or keep?                               | **Keep as-is** (no change)                                                                                                                                                                                                                                           |
| 4   | UI: digest card only, or also a header mode badge?                                         | **Card only** in v1                                                                                                                                                                                                                                                  |
| 5   | Config surface: global only, or per-model override?                                        | **Global only** (`context.digestRound`)                                                                                                                                                                                                                              |
| 6   | Round header wording & summary-time storage                                                | Header reads `## Round N — summarized <ISO ts>` (past participle, not noun "summary" nor "closed"); summary times stored structurally in `metadata.entries` as `summarizedAt` (machine-readable twin of the content, join key `messageId` back to the verbatim seed) |

## Repo doc conventions honored (audited 2026-09-19)

- **MTAE Key Principles** (`MTAE-ARCHITECTURE.md`): compaction is a _mode, not
  a separate path_ — the digest is emitted inside the existing compaction tail
  of the same loop; the loop never imports EventStore (digest uses the
  injected `append`); summary placement / tool-call rejection invariants
  unchanged. **No MTAE doc edits required.**
- **Event-shape contract** (`SESSION-DEBUGGING.md` L121): documented event
  payloads are the reference contract → this change **must update**
  `SESSION-DEBUGGING.md` (`context.compacted` += `digestRound?`,
  `turn.snapshot` += `digestRound?`) or reconstruction guidance silently
  breaks.
- **Snapshot discipline** (`SESSION-DEBUGGING.md` L148): every new durable
  field is carried in `turn.snapshot` and handled in `fold-state.ts` —
  satisfied by §4.
- **i18n** (`I18N.md`): guard paragraph and all LLM-facing text stay English
  (never translated); the new `compaction-digest` label is added via
  `t({en, fr})` without rewording existing strings (existing English strings
  are byte-asserted by tests).
- **Config validation**: `context.digestRound` goes through the Zod config
  schema (integer, `-1` or `≥ 0`; invalid values rejected at load with a
  clear error).
- **Completion gates** (`PR-REVIEW.md`): `npm run test` (unit + e2e) +
  `npm run typecheck` + `npm run lint` all green; PR targets `develop`,
  squash-merge.

## Test plan (TDD)

1. Fold: `digestRound` latest-wins across events + snapshots.
2. Snapshot round-trip: `digestRound` and `contextWindows` survive
   snapshot + `cleanupOldEvents`.
3. Compaction tail: `digestRound = 0` → no digest events; LLM context
   byte-identical to baseline.
4. `digestRound = -1` after 3 compactions → digest lists Rounds 1..3 in order,
   in a single `user` message, tagged to the new window.
5. `digestRound = 2` with 4 prior rounds → digest lists Rounds 3..4 only.
6. Switching: the tail reads `digestRound` from the runtime config at every
   compaction, and the decision is stamped per compaction event — so a
   `2 → 0 → -1` trajectory is correct round-by-round without any state to
   migrate (a mock-LLM loop run per mode covers 0, -1, and k).
7. Parity: digest present in top-level LLM context build, absent from
   sub-agent scope; snapshot path ≡ raw-event path
   (`buildCompactionDigest` returns byte-identical content for the same
   folded message set, tested).
8. Legacy: session with pre-feature events compacts → round numbering falls
   back to first-appearance order (no `session.initialized`), behaves as `0`
   when unconfigured.
9. `metadata.entries` ≡ content headers: same rounds, same `summarizedAt` as the
   seed messages' timestamps; `messageId` resolves to the seed text.
10. Anti-imitation: the guard paragraph is asserted inside `COMPACTION_PROMPT`
    (8-point contract intact), and both LLM-facing compaction prompts are
    tested to carry it — the normal path (`appendCompactionPrompt` emits the
    prompt verbatim) and the rejected-tool-call retry (agent-loop correction
    message embeds the prompt). The prompt is also tested NOT to be digest
    scaffolding itself (no concrete `## Round N` headers / pointer lines).

**Verification environment (hard constraint)**

- Unit/integration tests: Vitest in-process (mock LLM / temp DB) — no live
  environment involved.
- Manual/live verification: **openfox-dev only** — dev server via the
  `dev_server` tool (port 10469), dev config `~/.config/openfox-dev/`, dev DB
  `~/.local/share/openfox-dev/sessions.db`.
- **Production is never touched**: no writes to `~/.config/openfox/`, no
  sessions created/compacted on the prod DB (`~/.local/share/openfox/`,
  port 10369) — prod files are read-only for this work.

## Change list

| File                                         | Change                                                                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`                        | `context.compacted` data += `digestRound?`; `SessionSnapshot` += `digestRound?`; `Message.metadata` += `round?` + `entries?`; config `context.digestRound` |
| `src/server/config.ts`                       | default `digestRound: 0` + Zod validation (`-1` or integer `≥ 0`)                                                                                          |
| `docs/SESSION-DEBUGGING.md`                  | sync `context.compacted` / `turn.snapshot` payload docs                                                                                                    |
| `src/server/events/fold-state.ts`            | latest-wins fold in `foldContextState` + `foldSessionState`; snapshot builder includes `digestRound` + `contextWindows`                                    |
| `src/server/chat/agent-loop.ts`              | compaction tail: resolve `digestRound`, build projection, emit digest message, stamp event                                                                 |
| `src/server/chat/compaction-digest.ts`       | pure projection `buildCompactionDigest`; preamble/header/pointer templates inlined as literals                                                             |
| `src/server/chat/prompts.ts`                 | `COMPACTION_PROMPT` += anti-imitation guard (§2b)                                                                                                          |
| `web/src/components/plan/AutoPromptCard.tsx` | `compaction-digest` label + color (en/fr)                                                                                                                  |
| tests                                        | per test plan                                                                                                                                              |
