# Session Debugging Guide

> How to inspect and debug OpenFox sessions directly in the database.
> Schema version: **v3 conversation tree** (v3.0.0-beta+), stamped
> `PRAGMA user_version = 3` at init/migration. Design background:
> [CONVERSATION-TREE.md](CONVERSATION-TREE.md).

## Database Locations

| Environment | Path                                     |
| ----------- | ---------------------------------------- |
| Production  | `~/.local/share/openfox/sessions.db`     |
| Development | `~/.local/share/openfox-dev/sessions.db` |

> **Tip:** The agent workdir tells you which DB to use. If `workdir` contains "openfox" and it's your dev machine → dev DB. Otherwise → production DB.
>
> **v3 is a breaking release:** the upgrade runs an idempotent structural
> migration (legacy linear `events` table dropped and recreated in tree
> shape, `tombstones` dropped, `blobs` created, sessions backfilled), but
> pre-v3 event history is deliberately not carried over — old linear event
> logs and `turn.snapshot` rows are not readable by v3 code. Back up
> (`sqlite3 <db> ".backup <copy>"`) before upgrading; export important
> sessions from the old version first.

## Tables Overview

```
projects    → Project metadata (id, name, workdir)
sessions    → Session = (tree_id, cursor_event_id, config/metadata)
events      → Append-only tree of nodes (tree_id, event_id, parent_id, ...)
blobs       → Content-addressed storage for externalized large payloads
```

## Tables Deep Dive

### sessions

| Column                                                 | Type    | Description                                            |
| ------------------------------------------------------ | ------- | ------------------------------------------------------ |
| id                                                     | TEXT    | Session UUID                                           |
| project_id                                             | TEXT    | FK to projects                                         |
| workdir                                                | TEXT    | Working directory                                      |
| tree_id                                                | TEXT    | The conversation tree this session reads from          |
| cursor_event_id                                        | TEXT    | The node the conversation is currently at (branch tip) |
| message_count                                          | INTEGER | Cached count of real messages on the current path      |
| mode / phase                                           | TEXT    | (also derivable from events)                           |
| is_running                                             | INTEGER | 0 or 1 (stale values are reset at boot)                |
| provider_id / provider_model                           | TEXT    | Sticky provider/model preference                       |
| danger_level                                           | TEXT    | `normal` or `dangerous`                                |
| total_tokens_used / total_tool_calls / iteration_count | INTEGER | Cumulative stats                                       |
| created_at / updated_at                                | TEXT    | ISO timestamps                                         |

**Key insight**: a session is _where you are in a tree_, not a log. Two
sessions (forks) can share the same `tree_id` with different cursors.

### events

| Column     | Type    | Description                                 |
| ---------- | ------- | ------------------------------------------- |
| id         | INTEGER | Auto-increment PK                           |
| tree_id    | TEXT    | Tree this node belongs to (shared by forks) |
| event_id   | TEXT    | Stable node id                              |
| parent_id  | TEXT    | Node's parent (NULL = root); immutable      |
| seq        | INTEGER | Tree-global append order (not per-session!) |
| timestamp  | INTEGER | Unix ms                                     |
| event_type | TEXT    | Node type (see below)                       |
| payload    | TEXT    | JSON data; may reference a blob (`blobRef`) |

**Indexes**: `idx_events_tree_seq`, `idx_events_tree_type`,
`idx_events_tree_parent` (all `(tree_id, …)`).

> There is no `session_id` column anymore — filter by `tree_id` (get it from
> `sessions.tree_id`), then walk the path.

### blobs

| Column       | Type    | Description                                  |
| ------------ | ------- | -------------------------------------------- |
| content_hash | TEXT    | sha256 of the exact stored bytes (PK, dedup) |
| size         | INTEGER | Byte size                                    |
| content      | TEXT    | The full externalized payload                |

A node payload containing `{"blobRef": "...", "size": N, "preview": "…",
"truncated": true}` is a pointer into this table. Hydration is byte-identical
for LLM assembly; the UI shows the preview.

## Node Types

**Messages** — one `message` node per message (merged at turn end; streaming
chunks `message.delta`/`message.thinking` are WS-only and never stored):
`role`, `content`, `thinkingContent`, `toolCalls`, `attachments`, `stats`,
`contextWindowId`, `isCompactionSummary`, `isSystemGenerated`, `messageKind`.
Tool results are separate `tool.result` nodes (child of the assistant message),
paired at fold time.

**Lifecycle**: `session.initialized`, `session.name_generated`,
`mode.changed`, `phase.changed`, `running.changed`, `context.state`,
`context.compacted`, `file.read`, `criteria.set`, `criterion.updated`,
`todo.updated`, `metadata.set`, `workflow.*`, `task.completed`,
`chat.done`, `chat.error`, `chat.ask_user`, `path.confirmation_*`,
`vision_fallback.*`, `pattern.retry`.

**No `turn.snapshot`, no `tombstones` table.** State is always the fold of
the path `root → cursor` (messages, context state, criteria, todos, metadata,
mode, phase, context windows, read files).

## Loading a Session (Pseudocode)

```
1. (tree_id, cursor_event_id) = sessions row
2. path = walk parent_id links from cursor back to root, reverse
3. state = fold(path)            -- every field derives from the path
4. blobs: hydrate blobRef payloads on read (byte-identical)
```

## Common Debug Queries

> Replace `:tree` with a tree id and `:cursor` with a cursor event id.
> Get both: `SELECT tree_id, cursor_event_id FROM sessions WHERE id = 'SESSION';`

### The Full Path (root → cursor)

```sql
WITH RECURSIVE path AS (
  SELECT event_id, parent_id, seq, event_type, payload, 0 AS depth
  FROM events WHERE tree_id = ':tree' AND event_id = ':cursor'
  UNION ALL
  SELECT e.event_id, e.parent_id, e.seq, e.event_type, e.payload, p.depth + 1
  FROM events e JOIN path p ON e.event_id = p.parent_id
  WHERE e.tree_id = ':tree'
)
SELECT seq, event_type, substr(payload, 1, 100) AS preview, depth
FROM path ORDER BY seq;
```

### Branch Structure (whole tree)

```sql
SELECT seq, event_id, parent_id, event_type,
       substr(payload, 1, 80) AS preview
FROM events WHERE tree_id = ':tree' ORDER BY seq;
```

### Abandoned Branches (tips off the current path)

```sql
-- Leaves of the tree that are NOT on the cursor path
WITH RECURSIVE path AS (
  SELECT event_id, parent_id FROM events WHERE tree_id = ':tree' AND event_id = ':cursor'
  UNION ALL
  SELECT e.event_id, e.parent_id FROM events e JOIN path p ON e.event_id = p.parent_id
  WHERE e.tree_id = ':tree'
),
tips AS (
  SELECT e.* FROM events e
  WHERE e.tree_id = ':tree'
    AND NOT EXISTS (SELECT 1 FROM events c WHERE c.tree_id = ':tree' AND c.parent_id = e.event_id)
    AND NOT EXISTS (SELECT 1 FROM path p WHERE p.event_id = e.event_id)
)
SELECT seq, event_id, event_type, substr(payload, 1, 100) AS preview
FROM tips ORDER BY seq;
```

### Forks (sessions sharing a tree)

```sql
SELECT id, title, cursor_event_id, message_count, is_running, updated_at
FROM sessions WHERE tree_id = ':tree';
```

### Messages with Content (path, hydrated)

```sql
SELECT seq,
       json_extract(payload, '$.messageId') AS message_id,
       json_extract(payload, '$.role') AS role,
       substr(COALESCE(json_extract(payload, '$.content'),
              json_extract(payload, '$.preview')), 1, 120) AS content_preview,
       CASE WHEN json_extract(payload, '$.blobRef') IS NOT NULL THEN 1 ELSE 0 END AS externalized
FROM events
WHERE tree_id = ':tree' AND event_type = 'message' ORDER BY seq;
```

### Externalized Payloads (blobs)

```sql
SELECT b.content_hash, b.size, substr(b.content, 1, 200) AS head
FROM blobs b ORDER BY b.size DESC;

-- Which nodes point at which blobs
SELECT e.event_id, e.event_type, json_extract(e.payload, '$.blobRef') AS ref
FROM events e
WHERE e.tree_id = ':tree' AND e.payload LIKE '%"blobRef"%';
```

### Tool Calls with Results

```sql
SELECT json_extract(m.payload, '$.messageId') AS message_id,
       json_extract(tc.payload, '$.toolCallId') AS tool_call_id,
       json_extract(tc.payload, '$.result.success') AS success,
       substr(json_extract(tc.payload, '$.result.error'), 1, 200) AS error
FROM events m JOIN events tc ON tc.parent_id = m.event_id
WHERE m.tree_id = ':tree' AND m.event_type = 'message'
  AND tc.event_type = 'tool.result';
```

### Context / Compaction History

```sql
SELECT seq, event_type,
       json_extract(payload, '$.newWindowId') AS new_window,
       json_extract(payload, '$.beforeTokens') AS before_tokens,
       substr(json_extract(payload, '$.summary'), 1, 120) AS summary_preview
FROM events
WHERE tree_id = ':tree' AND event_type IN ('context.compacted', 'context.state')
ORDER BY seq;
```

### Failed Tool Calls

```sql
SELECT seq,
       json_extract(payload, '$.toolCallId') AS tool_call_id,
       substr(json_extract(payload, '$.result.error'), 1, 300) AS error
FROM events
WHERE tree_id = ':tree' AND event_type = 'tool.result'
  AND json_extract(payload, '$.result.success') = 0
ORDER BY seq DESC;
```

### Event Count by Type

```sql
SELECT event_type, COUNT(*) AS count, SUM(length(payload)) AS bytes
FROM events WHERE tree_id = ':tree' GROUP BY event_type ORDER BY count DESC;
```

## CLI Shortcuts

```bash
# Tree + cursor for a session
sqlite3 ~/.local/share/openfox-dev/sessions.db \
  "SELECT tree_id, cursor_event_id FROM sessions WHERE id = 'XXX';"

# Node census
sqlite3 ~/.local/share/openfox-dev/sessions.db \
  "SELECT event_type, COUNT(*), SUM(length(payload)) FROM events WHERE tree_id = 'TREE' GROUP BY 1 ORDER BY 2 DESC;"

# Largest blobs (oversized externalized payloads)
sqlite3 ~/.local/share/openfox-dev/sessions.db \
  "SELECT content_hash, size FROM blobs ORDER BY size DESC LIMIT 10;"
```

## When to Use This

- Debugging why an agent made a certain decision (fold the path)
- Understanding tool call failures
- Tracing context compaction / window boundaries
- Inspecting branch structure (forks, abandoned branches, resend siblings)
- Checking what's externalized to blobs
- Auditing agent behavior from the raw tree
