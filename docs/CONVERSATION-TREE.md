# Conversation Tree (v3)

Message-level tree storage for session conversations. A session is a **cursor
over an append-only tree of events** — forking is O(1), branch switching is a
cursor move, and the LLM request for any branch is exactly the prefix that
branch was already served (KV-prefix friendly).

This is the v3.0.0-beta architecture. It **replaces** the v1 linear event log
(seq-ordered per session, turn snapshots, seq-based GC).

## Schema

```sql
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tree_id    TEXT NOT NULL,        -- shared conversation tree
  event_id   TEXT NOT NULL,        -- node id (stable, content-independent)
  parent_id  TEXT,                 -- null for the root; node path is immutable
  seq        INTEGER NOT NULL,     -- per-tree append order (tree-global)
  timestamp  INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload    TEXT NOT NULL,
  UNIQUE (tree_id, event_id)
);

CREATE TABLE blobs (
  content_hash TEXT PRIMARY KEY,   -- sha256 of the exact externalized bytes
  size         INTEGER NOT NULL,
  content      TEXT NOT NULL
);

-- sessions row: (tree_id, cursor_event_id, message_count, ...)
```

- **Nodes are append-only.** Once created, a node's `parent_id`, `seq`, and
  payload never change. A "branch" is simply a new node whose parent is an
  interior node of an existing path.
- **Sessions share trees.** The `sessions` table stores `(tree_id,
cursor_event_id)`: the cursor is the node the conversation is currently at.
  Two sessions on the same tree (forks) share every prefix node physically.
- **Blobs** are content-addressed storage for oversized payloads (below).
  Duplicate content is stored exactly once.

## Node types

| Persistence           | Event types                                                                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merged `message` node | one node per message: `role`, `content`, `thinkingContent`, `toolCalls`, `attachments`, `stats`, `contextWindowId`, `isCompactionSummary`, `isSystemGenerated`, `messageKind`                                                                                                               |
| Lifecycle nodes       | `session.*`, `mode.changed`, `phase.changed`, `context.state`, `context.compacted`, `running.changed`, `chat.done`, `criteria.*`, `todo.updated`, `metadata.set`, `file.read`, `workflow.*`, `path.confirmation_*`, `chat.ask_user`, `vision_fallback.*`, `pattern.retry`, `task.completed` |
| `tool.result` node    | separate node per tool result (child of the assistant message) — pairing happens at fold time                                                                                                                                                                                               |
| **Not persisted**     | streaming chunks: `message.delta`, `message.thinking`, `tool_call_delta`/`tool.output` — WS-only, in-memory until `message.done` merges them                                                                                                                                                |

The chunk events are ephemeral: they flow over WebSocket for live rendering,
and the merge buffer produces **exactly one** `message` node per message when
the turn's `message.done` arrives. A fork of a session mid-stream therefore
never contains partial content — only complete messages.

## The four operations

| Operation           | Tree effect                                                                                               | Cost                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **send**            | new node as child of the cursor; cursor advances                                                          | 1 insert                                     |
| **branch / rewind** | cursor moves to an existing `message` boundary                                                            | 0 inserts (validated: message type, in-tree) |
| **edit & resend**   | new _sibling_ node (same parent, fresh id) + cursor move; the original branch stays intact and switchable | 1 insert                                     |
| **fork**            | new `sessions` row pointing at `(same tree, node)`                                                        | 0 inserts (no copy)                          |

**Compaction** appends a `context.compacted` boundary node (closed window, new
window, summary). The context builder starts from the newest boundary:
post-compaction context = summary + messages of the new window. Because the
boundary node sits on the shared tree, **every fork inherits the same
window boundaries** — forking a compacted session can no longer re-inject the
discarded history (issue #334).

## KV prefix sharing

The LLM request for a session is the fold of `root → cursor`. In a single
linear chain this is byte-identical to the old implementation's request.
After branch/rewind/fork, the request is a **prefix that was already served**
for that branch, so provider-side prefix (KV) caches hit at 100% — the
cost of a branch switch is the delta from the fork point, not the whole
history. Compaction stays in-context (summary + recent window appended after
the frozen cached layout), so the frozen prefix cache is preserved.

## Blob externalization

Payloads over threshold are stored in `blobs` and the node carries
`{ blobRef, size, preview, truncated }` instead of the full text:

- `message.content` — externalized when the merged payload exceeds 1 MB
  (`MESSAGE_EXTERNALIZE_THRESHOLD`)
- `tool.result` — externalized above 256 KB (`BLOB_EXTERNALIZE_THRESHOLD`),
  preview = first 4 KB of result text

Hydration on read is byte-identical (KV-neutral): the LLM assembly materializes
the full content from the blob. The UI renders the preview and can load the
full blob on demand. This eliminates the v1 failure mode where a single
`tool.result`/snapshot row grew to 200 MB+.

## Garbage collection

The v1 "truncate seqs before the snapshot" GC is **structurally incompatible**
with trees (sibling branches share prefixes; a deleted seq range is not
addressable) and is deleted entirely, along with the `tombstones` table.

Replacement:

- **`gcDeadBranches(maxAgeMs?)`** — an entire tree with no session referencing
  it is deleted (nodes + blobs); a tree still referenced is left alone,
  including abandoned branches (they are switchable until the session goes
  away). Runs on a 7-day interval with a grace period.
- **Blob reference counting** — after any node deletion, blob refs no longer
  mentioned by any surviving payload are harvested (`deleteUnreferencedBlobs`).

## Protocol / REST / export

- **WS**: connect → `session.state` (cursor fold: messages + context +
  stats, in-flight streaming messages included — identical to the REST
  payload). Live updates are node events (merged `message` nodes, lifecycle
  nodes) plus ephemeral chunk events. Ephemeral events carry `seq: 0`; only
  tree-persisted nodes carry tree seqs. Reconnect catch-up replays the path.
- **REST**:
  - `GET /api/sessions/:id/conversation-tree` → `{ treeId, cursor, tips, nodes }`
    (`tips` = abandoned branch tips, each normalized to its nearest message
    boundary with preview/role)
  - `POST /api/sessions/:id/conversation-branch { messageId }` → cursor move
    (409 while running; broadcasts `session.state` for parity with REST)
  - `POST /api/sessions/:id/replay { messageId, content?, attachments? }` →
    sibling + queued turn (non-destructive edit & resend)
  - `POST /api/sessions/:id/fork { messageId, title? }` → 201, shared tree
  - `GET /api/sessions/:id/export` / `POST /api/sessions/import` → v2 tree
    document (events carry `eventId`/`parentId`, payload carries
    `cursorEventId`); round-trips the current path + cursor. **Version 1
    exports are rejected with a clear error** (breaking change, see below).
- **UI**: the sidebar workspace popover lists abandoned conversation branches
  (preview + role + time); clicking one switches the cursor and the feed
  re-renders from the broadcast state.

## Tradeoffs

- **Chunk-level audit is dropped.** v1 persisted every streaming chunk, which
  allowed byte-level reconstruction of the stream and per-chunk debugging.
  v3 persists the merged message only: what the LLM actually saw (content,
  thinking, tool calls, results, stats) is fully preserved and byte-stable,
  but the _segmentation_ of deltas/thinking chunks is not recoverable after
  the fact. Liveness debugging uses the WS stream (and verbose logs), not the
  database. This is what makes trees viable: a 300k-chunk stream becomes a
  single node.
- **No v1→v3 migration.** Old databases are not upgraded; pre-v3 history is
  not importable and pre-v3 exports are rejected. This is a deliberate
  breaking change for 3.0.0-beta (see release notes).
- **Export carries the current path**, not abandoned branches — a session
  export is the conversation the session is at, plus the cursor. Abandoned
  branches are a live-tree feature; they are not shipped in export documents.

## Performance (measured)

Reference: in-process server, in-memory SQLite, mock LLM, 2,714-node tree
(1,142 merged messages, incl. a real production session of 665 messages /
5 compactions replayed through the normal append path — see
`e2e/conversation-tree-perf.test.ts` and `e2e/fixtures/real-session.json`):

| Operation                                 | P95             |
| ----------------------------------------- | --------------- |
| path resolution + hydration (`getEvents`) | 0.1 ms          |
| message fold + LLM context build          | 28 ms           |
| `conversation-tree` endpoint              | 4 ms            |
| branch tips                               | 1.2 ms          |
| fork (REST) / branch switch (REST)        | < 200 ms budget |

The same real session in v1 was 343,738 rows / 36.5 MB (293k thinking chunks,
a 233 MB-class single snapshot row). In v3 it is ~3k nodes; oversized content
lives in deduplicated blobs.

## Related

- `docs/SESSION-DEBUGGING.md` — database inspection for the v2/v3 schema
- `src/server/events/tree.ts` — merge + externalization primitives
- `src/server/events/store.ts` — tree store (cursors, branches, GC, blobs)
