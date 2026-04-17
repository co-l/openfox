# Event Source Integration

## Current State (as of April 2026)

The `eventStore` IS wired to WebSocket broadcasting via `eventStore.subscribeAll()`:
- Added: `e541997` (Apr 15, 2026) - "feat: connection status bar and global event subscription"
- `storedEventToServerMessage()` implemented in `protocol.ts:332`

**The infrastructure exists. The bug was a specific code path not using it.**

## The Actual Bug

When `injectKickoff()` was called in `runBuilderTurn()`, it was:
```typescript
eventStore.append(sessionId, createMessageStartEvent(...))  // ✅ Persisted to DB
// ❌ Missing: options.onMessage() call - NOT sent to frontend during streaming
```

The frontend only saw the message after:
1. `session.state` sent at end of streaming (full sync)
2. Page reload (reads from DB)

**Why this specific path was broken:** The `injectKickoff` callback is called from `agent-loop.ts:282` before LLM streaming starts. It wrote to eventStore but never called `onMessage`.

## Corrected Understanding

### Infrastructure (Exists ✅)
```
eventStore.subscribeAll() ──→ storedEventToServerMessage() ──→ WebSocket broadcast
```

### The Gap
Code paths that call `eventStore.append()` but NOT `onMessage()`:
- `orchestrator.ts:injectKickoff()` - **FIXED (66139f5)**
- Other code paths may have similar issues

## Affected Code Still Needing Review

Manual `onMessage` calls exist alongside `eventStore.append()`. Some are:
- **Intentional workarounds** for code paths that don't trigger WebSocket broadcast
- **Intentional** for immediate real-time updates (faster than waiting for eventStore subscription)

### Current call sites to verify:
- `orchestrator.ts` - mode reminders, builder kickoff
- `agent-loop.ts` - correction prompts, mode reminders  
- `executor.ts` - workflow prompts, nudge prompts

## When to Use onMessage vs Rely on eventStore

### Use `eventStore.append()` only (preferred):
When you want eventual consistency and don't need immediate frontend display.
- Tool results
- Message deltas
- Async state changes

### Use both `eventStore.append()` AND `onMessage()`:
When you need immediate frontend display before the next streaming update:
- Mode reminders (Plan Mode / Build Mode)
- Builder kickoff prompts
- Any user-facing message that must appear instantly

## Required Fix

### Verify all code paths use onMessage when needed

Check each `eventStore.append()` of `message.start`/`message.done` events:
1. Does the frontend need to display this immediately?
2. If yes, is `onMessage()` also called?
3. If no, the message will only appear after streaming ends or page reload

### Future: Unified approach

Eventually, `eventStore.subscribeAll()` → `storedEventToServerMessage()` should handle ALL real-time broadcasting automatically. At that point, manual `onMessage` calls can be removed.

## Benefits

1. **Single source of truth** - eventStore is truly the source for both paths
2. **Consistent behavior** - no more "updates only after streaming"
3. **Simpler code** - remove manual `onMessage` calls
4. **Easier debugging** - one place to trace event flow

## Status

- [x] Wire eventStore.subscribeAll() to WebSocket broadcasting (e541997)
- [x] Implement event-to-WS-message translation (storedEventToServerMessage)
- [ ] Audit all message.start/message.done events for missing onMessage calls
- [ ] Remove redundant onMessage calls where eventStore subscription is sufficient
- [ ] Test parity between fresh load and streaming

## References

- `src/server/ws/server.ts:419` - eventStore.subscribeAll() in action
- `src/server/ws/protocol.ts:332` - storedEventToServerMessage()
- `src/server/events/store.ts` - subscribeAll() implementation