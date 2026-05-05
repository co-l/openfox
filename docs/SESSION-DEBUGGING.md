# Session Debugging Guide

> How to inspect and debug OpenFox sessions directly in the database.

## Database Locations

| Environment | Path                                     |
| ----------- | ---------------------------------------- |
| Production  | `~/.local/share/openfox/sessions.db`     |
| Development | `~/.local/share/openfox-dev/sessions.db` |

> **Tip:** The agent workdir tells you which DB to use. If `workdir` contains "openfox" and it's your dev machine → dev DB. Otherwise → production DB.

## Tables Overview

```
projects    → Project metadata (id, name, workdir)
sessions    → Session metadata (id, project_id, mode, phase, isRunning, etc.)
events      → The real source of truth - all session state as events
settings    → Global configuration (e.g., custom instructions)
```

## Tables Deep Dive

### projects

| Column              | Type | Description                            |
| ------------------- | ---- | -------------------------------------- |
| id                  | TEXT | UUID                                   |
| name                | TEXT | Project display name                   |
| workdir             | TEXT | Absolute path to project root          |
| created_at          | TEXT | ISO timestamp                          |
| updated_at          | TEXT | ISO timestamp                          |
| custom_instructions | TEXT | Optional project-specific instructions |

### sessions

| Column            | Type    | Description                             |
| ----------------- | ------- | --------------------------------------- |
| id                | TEXT    | Session UUID                            |
| project_id        | TEXT    | FK to projects                          |
| workdir           | TEXT    | Working directory for this session      |
| mode              | TEXT    | `planner` or `builder`                  |
| phase             | TEXT    | `plan`, `build`, `verification`, `done` |
| is_running        | INTEGER | 0 or 1                                  |
| workflow_phase    | TEXT    | Alias for phase (legacy)                |
| phase             | TEXT    | Legacy state machine phase              |
| title             | TEXT    | Session title                           |
| summary           | TEXT    | Completion summary (filled on done)     |
| provider_id       | TEXT    | Override LLM provider ID                |
| provider_model    | TEXT    | Override model name                     |
| danger_level      | TEXT    | `normal` or `dangerous`                 |
| message_count     | INTEGER | Cached message count                    |
| total_tokens_used | INTEGER | Cumulative token count                  |
| total_tool_calls  | INTEGER | Cumulative tool call count              |
| iteration_count   | INTEGER | Number of agent iterations              |
| created_at        | TEXT    | ISO timestamp                           |
| updated_at        | TEXT    | ISO timestamp                           |

**Key insight**: The `sessions` table only stores metadata. The actual conversation lives in `events`.

### events

This is the single source of truth. All session state derives from events.

| Column     | Type    | Description                              |
| ---------- | ------- | ---------------------------------------- |
| id         | INTEGER | Auto-increment PK                        |
| session_id | TEXT    | FK to sessions                           |
| seq        | INTEGER | Per-session sequence number (1, 2, 3...) |
| timestamp  | INTEGER | Unix timestamp (ms)                      |
| event_type | TEXT    | Event type (see below)                   |
| payload    | TEXT    | JSON event data                          |

**Indexes**:

- `idx_events_session_seq` - For fetching events by session + sequence
- `idx_events_session_type` - For filtering by event type

## Event Types

### Session Lifecycle

| Event Type               | Description                                                                   |
| ------------------------ | ----------------------------------------------------------------------------- |
| `session.initialized`    | Session created (seq 1). Contains: projectId, workdir, contextWindowId, title |
| `session.name_generated` | Auto-generated session title                                                  |

### Message Lifecycle

| Event Type         | Description                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `message.start`    | Message begun. Contains: messageId, role, content, contextWindowId, subAgentId, subAgentType, isSystemGenerated, messageKind, tokenCount |
| `message.delta`    | Streaming content chunk. Contains: messageId, content                                                                                    |
| `message.thinking` | Streaming thinking chunk. Contains: messageId, content                                                                                   |
| `message.done`     | Message complete. Contains: messageId, stats, segments, partial, promptContext, tokenCount                                               |

### Tool Lifecycle

| Event Type       | Description                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `tool.preparing` | Tool call starting. Contains: messageId, index, name                                                   |
| `tool.call`      | Tool invoked. Contains: messageId, toolCall (id, name, arguments)                                      |
| `tool.output`    | Streaming stdout/stderr. Contains: toolCallId, stream, content                                         |
| `tool.result`    | Tool finished. Contains: messageId, toolCallId, result (success, output, error, durationMs, truncated) |

### State Changes

| Event Type          | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `mode.changed`      | Mode switched (planner ↔ builder). Contains: mode, auto, reason     |
| `phase.changed`     | Phase changed (plan → build → verification → done). Contains: phase |
| `running.changed`   | Execution state. Contains: isRunning                                |
| `criteria.set`      | Criteria assigned. Contains: criteria[]                             |
| `criterion.updated` | Criterion status changed. Contains: criterionId, status             |

### Context Management

| Event Type          | Description                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `context.state`     | Token tracking. Contains: currentTokens, maxTokens, compactionCount, dangerZone, canCompact         |
| `context.compacted` | Context window compacted. Contains: closedWindowId, newWindowId, beforeTokens, afterTokens, summary |
| `file.read`         | File read for cache tracking. Contains: path, tokenCount, contextWindowId                           |

### Snapshots (Critical!)

| Event Type      | Description                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `turn.snapshot` | Full state at end of turn. Contains everything: mode, phase, isRunning, messages[], criteria[], todos[], contextState, currentContextWindowId, readFiles, lastModeWithReminder |

> **This is the most important event type.** Snapshots capture the complete session state at a point in time.

### Other Events

| Event Type                                                 | Description                                                                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `todo.updated`                                             | Builder todo list. Contains: todos[]                                                                                                          |
| `task.completed`                                           | Session finished. Contains: summary, iterations, totalTimeSeconds, totalToolCalls, totalTokensGenerated, criteria[], workflowName, workflowId |
| `queue.added`, `queue.drained`, `queue.cancelled`          | Message queue for deferred prompts                                                                                                            |
| `chat.done`, `chat.error`, `chat.ask_user`                 | Control flow                                                                                                                                  |
| `path.confirmation_pending`, `path.confirmation_responded` | Permission persistence                                                                                                                        |

## The Snapshot Mechanism (Key Concept)

OpenFox uses **event sourcing** with **snapshots** for efficiency:

1. **At turn end**, agent emits a `turn.snapshot` event
2. Snapshot contains **complete state**: all messages with tool results attached, criteria, todos, context state
3. Old events **before the snapshot** can be garbage collected
4. Loading a session = get latest snapshot + fold events **after** it

### Loading a Session (Pseudocode)

```
1. Get latest turn.snapshot event (if any)
2. If snapshot exists:
   - Start with snapshot state
   - Apply all events AFTER snapshot seq (for incremental changes)
3. If no snapshot:
   - Fold ALL events from seq 1
```

This is why you can't just query the DB directly - you need to understand folding to reconstruct current state.

## Common Debug Queries

### Find Sessions for a Project

```sql
-- List all sessions for a project
SELECT id, title, mode, phase, is_running, created_at, updated_at
FROM sessions
WHERE project_id = '70cafde1-b5c2-4099-b61d-011730170bfd'
ORDER BY updated_at DESC;
```

### Find by Workdir

```sql
-- Find project by workdir
SELECT * FROM projects WHERE workdir LIKE '%openfox%';

-- Then get sessions
SELECT * FROM sessions WHERE project_id = '70cafde1-b5c2-4099-b61d-011730170bfd';
```

### List All Events for a Session (Chronological)

```sql
SELECT seq, event_type, timestamp,
       substr(payload, 1, 100) AS payload_preview
FROM events
WHERE session_id = 'f30e26e3-90ac-49ab-8355-ccb7311d0e35'
ORDER BY seq;
```

### Get Latest Snapshot

```sql
SELECT payload FROM events
WHERE session_id = 'f30e26e3-90ac-49ab-8355-ccb7311d0e35'
  AND event_type = 'turn.snapshot'
ORDER BY seq DESC
LIMIT 1;
```

### Get Full Snapshot (Pretty Printed)

```sql
-- Output as JSON for easy reading
SELECT json_pretty(payload) FROM events
WHERE session_id = 'f30e26e3-90ac-49ab-8355-ccb7311d0e35'
  AND event_type = 'turn.snapshot'
ORDER BY seq DESC
LIMIT 1;
```

### Extract Messages from Snapshot

```sql
SELECT json_each.value AS message
FROM events,
     json_events(payload) AS payload,
     json_each(payload->'messages') AS json_each
WHERE events.session_id = 'f30e26e3-90ac-49ab-8355-ccb7311d0e35'
  AND events.event_type = 'turn.snapshot'
ORDER BY events.seq DESC
LIMIT 1;
```

### Get Tool Calls with Results

```sql
-- Find all tool.result events for a session
SELECT
  json_extract(payload, '$.messageId') AS message_id,
  json_extract(payload, '$.toolCallId') AS tool_call_id,
  json_extract(payload, '$.result.success') AS success,
  json_extract(payload, '$.result.output') AS output,
  json_extract(payload, '$.result.error') AS error,
  json_extract(payload, '$.result.durationMs') AS duration_ms
FROM events
WHERE session_id = 'f30e26e3-90ac-49ab-8355-ccb7311d0e35'
  AND event_type = 'tool.result'
ORDER BY seq;
```

### Get Context History

```sql
-- See all context.state events (shows token usage over time)
SELECT seq, payload
FROM events
WHERE session_id = 'f30e26e3-90ac-49ab-8355-ccb7311d0e35'
  AND event_type = 'context.state'
ORDER BY seq;
```

### Get Criteria History

```sql
-- Latest criteria.set event shows current criteria
SELECT payload FROM events
WHERE session_id = 'f30e26e3-90ac-49ab-8355-ccb7311d0e35'
  AND event_type = 'criteria.set'
ORDER BY seq DESC
LIMIT 1;
```

### Find Failed Tool Calls

```sql
SELECT
  seq,
  json_extract(payload, '$.messageId') AS message_id,
  json_extract(payload, '$.toolCallId') AS tool_call_id,
  json_extract(payload, '$.result.error') AS error
FROM events
WHERE session_id = 'f30e26e3-90ac-49ab-8355-ccb7311d0e35'
  AND event_type = 'tool.result'
  AND json_extract(payload, '$.result.success') = 0
ORDER BY seq DESC;
```

### Find Sub-agent Executions

```sql
-- Find when sub-agents were invoked
SELECT seq, payload FROM events
WHERE session_id = 'f30e26e3-90ac-49ab-8355-ccb7311d0e35'
  AND event_type = 'tool.call'
  AND json_extract(payload, '$.toolCall.name') = 'call_sub_agent'
ORDER BY seq;
```

### Check Running State

```sql
-- Find the last running.changed event
SELECT payload FROM events
WHERE session_id = 'f30e26e3-90ac-49ab-8355-ccb7311d0e35'
  AND event_type = 'running.changed'
ORDER BY seq DESC
LIMIT 1;
```

### Find Session by Title (Partial Match)

```sql
SELECT * FROM sessions
WHERE title LIKE '%reproduce%'
ORDER BY updated_at DESC;
```

### Get Event Count by Type

```sql
SELECT event_type, COUNT(*) as count
FROM events
WHERE session_id = 'f30e26e3-90ac-49ab-8355-ccb7311d0e35'
GROUP BY event_type
ORDER BY count DESC;
```

### Find Errors

```sql
-- All error events
SELECT seq, event_type, payload FROM events
WHERE session_id = 'f30e26e3-90ac-49ab-8355-ccb7311d0e35'
  AND event_type IN ('chat.error', 'format.retry')
ORDER BY seq;
```

## Quick Reference: Finding a Session

```
1. From agent workdir, determine environment:
   - workdir contains project name → find project in appropriate DB

2. Find project:
   SELECT * FROM projects WHERE workdir = '/path/to/project';

3. Find session:
   SELECT * FROM sessions WHERE project_id = 'PROJECT_ID' ORDER BY updated_at DESC;

4. Get events:
   SELECT * FROM events WHERE session_id = 'SESSION_ID' ORDER BY seq;
```

## Understanding Message Structure in Snapshots

Messages in a `turn.snapshot` have this structure:

```json
{
  "id": "message-uuid",
  "role": "user|assistant|system|tool",
  "content": "...",
  "thinkingContent": "...",
  "toolCalls": [
    {
      "id": "call-uuid",
      "name": "read_file",
      "arguments": {"path": "..."},
      "result": {
        "success": true,
        "output": "...",
        "durationMs": 123,
        "truncated": false
      }
    }
  ],
  "segments": [...],
  "stats": {...},
  "contextWindowId": "window-uuid",
  "subAgentId": "sub-agent-uuid",
  "subAgentType": "code_reviewer|verifier|...",
  "isSystemGenerated": true,
  "messageKind": "auto-prompt|correction|context-reset|...",
  "promptContext": {...},
  "timestamp": 1775673056419
}
```

**Key fields**:

- `toolCalls[].result` - Only present in snapshots (filled in after tool completes)
- `promptContext` - What was sent to the LLM (system prompt, injected files, etc.)
- `contextWindowId` - Groups messages into context windows (resets on compaction)
- `subAgentType` - Identifies sub-agent execution context

## CLI Shortcuts

```bash
# SQLite3 basics
sqlite3 ~/.local/share/openfox-dev/sessions.db "SELECT * FROM sessions LIMIT 5;"

# Pretty print JSON payloads
sqlite3 ~/.local/share/openfox-dev/sessions.db \
  "SELECT json_pretty(payload) FROM events WHERE session_id = 'XXX' AND event_type = 'turn.snapshot' LIMIT 1;" | less -S

# Count events per type
sqlite3 ~/.local/share/openfox-dev/sessions.db \
  "SELECT event_type, COUNT(*) FROM events WHERE session_id = 'XXX' GROUP BY event_type;"
```

## When to Use This

- Debugging why an agent made a certain decision
- Understanding tool call failures
- Tracing context compaction events
- Finding what was sent to the LLM (promptContext in snapshot)
- Auditing agent behavior
- Reproducing bugs from a session log
