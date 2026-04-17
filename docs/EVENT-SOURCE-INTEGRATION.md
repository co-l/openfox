# Event Source Integration

## Current Architecture Issue

The `eventStore` is designed to be the single source of truth for all session state, intended to provide parity between:
- Fresh page loads (reads from DB)
- Real-time streaming (WebSocket)

However, this parity is **incomplete**. The eventStore is persisted to DB but **not wired to WebSocket broadcasting**.

## The Gap

### EventStore Flow
```
eventStore.append(sessionId, event)
         ↓
    [persisted to DB] ✅
```

### WebSocket Flow
```
onMessage callback → ws.send()
         ↓
    [manual calls throughout codebase] ⚠️
```

### Missing Piece
```
eventStore → WebSocket broadcast ❌
```

## Why This Matters

When a message is appended to the eventStore:
- It persists to DB ✅
- It will appear on fresh load ✅  
- It does NOT broadcast to frontend during streaming ❌

This causes real-time UI updates to lag until:
- `session.state` sent at end of streaming
- Manual `onMessage` calls (current workaround)

## Affected Code

### Manual onMessage Workarounds
Throughout the codebase, `onMessage` is called alongside `eventStore.append()`:

- `src/server/chat/orchestrator.ts` - mode reminders, builder kickoff
- `src/server/chat/agent-loop.ts` - correction prompts, mode reminders  
- `src/server/workflows/executor.ts` - workflow prompts, nudge prompts

### Example (orchestrator.ts)
```typescript
eventStore.append(sessionId, createMessageStartEvent(...))
// ❌ Missing: broadcast to WebSocket

// Workaround:
if (options.onMessage) {
  options.onMessage(createChatMessageMessage(...))
}
```

## Current WebSocket Subscription

The WebSocket server subscribes to `sessionManager.subscribe()`:
```typescript
// server.ts:309
sessionManager.subscribe((event) => {
  // Only handles: session_created, session_updated
  // NOT: message.start, message.done, etc.
})
```

The `eventStore.subscribe()` exists but isn't used for broadcasting:
```typescript
// events/store.test.ts:312 - Exists but unused
store.subscribe('session-1')
```

## Required Fix

### 1. Subscribe to EventStore in WebSocket Server

```typescript
// src/server/ws/server.ts
const { iterator, unsubscribe } = eventStore.subscribeAll()

for await (const event of iterator) {
  // Convert event to WebSocket message
  const wsMessage = translateEventToWebSocketMessage(event)
  
  // Broadcast to subscribed clients
  broadcastForSession(event.sessionId, wsMessage)
}
```

### 2. Implement Event Translation

Map event types to WebSocket messages:
- `message.start` → `chat.message`
- `message.delta` → `chat.delta`
- `message.done` → `chat.message_updated`
- `tool.call` → `chat.tool_call`
- etc.

### 3. Remove Manual onMessage Calls

Once the bridge is in place, remove `onMessage` callbacks from:
- `runBuilderTurn()`
- `runGenericAgentTurn()`
- `runVerifierTurn()`
- `runBuilderStep()`
- etc.

This simplifies the codebase and ensures consistent behavior.

## Benefits

1. **Single source of truth** - eventStore is truly the source for both paths
2. **Consistent behavior** - no more "updates only after streaming"
3. **Simpler code** - remove manual `onMessage` calls
4. **Easier debugging** - one place to trace event flow

## Status

- [ ] Wire eventStore.subscribeAll() to WebSocket broadcasting
- [ ] Implement event-to-WS-message translation
- [ ] Remove manual onMessage callbacks from orchestrator/agent-loop
- [ ] Remove manual onMessage callbacks from workflow executor
- [ ] Test parity between fresh load and streaming