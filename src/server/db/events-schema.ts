/**
 * Schema shared by the two places that bootstrap the `events` table:
 * `runMigrations()` (server startup) and `EventStore.initSchema()` (any store,
 * including tests and tools that open the database directly).
 *
 * The index set lives here so the two DDL copies cannot drift.
 */

/**
 * Indexes for `events`.
 *
 * The covering index serves the per-session, type-filtered reads: the snapshot
 * lookup (`event_type = 'turn.snapshot' ORDER BY seq DESC LIMIT 1`), the
 * context-window fold and the cleanup DELETE. Without `seq` in the index,
 * SQLite walks the whole session backwards and fetches each row — measured at
 * 105 ms per snapshot lookup on a 322k-event session, on every state load.
 *
 * The two dropping statements remove the superseded indexes on existing
 * databases: `(session_id, seq)` is already covered by the UNIQUE constraint's
 * auto-index, and `(session_id, event_type)` is a prefix of the covering index.
 * Both only cost a b-tree write per appended event — the hottest write path.
 */
export const EVENTS_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_events_session_type_seq ON events(session_id, event_type, seq);
  DROP INDEX IF EXISTS idx_events_session_seq;
  DROP INDEX IF EXISTS idx_events_session_type;
`
