# Multi-Turn Agentic Engine — Architecture

## Goal

Simplify the agent loop to its core. A composable, testable engine where each concern is handled by a focused sub-function, coordinated by a thin control loop. The EventStore is the single source of truth — the loop never imports it directly.

---

## Vision

```
User prompt enters
  │
  ├── store in EventStore
  ├── inject agent definition (full on mode switch, reminder otherwise)
  └── handle vision fallback if needed
  │
  └── LOOP:
        1. build context from EventStore events
        2. stream LLM response (thinking, content, tool_calls, usage)
        3. if promptTokens > 80% max_context → enter compaction loop
        4. match auto-loop patterns (XML protection, etc.) → auto-respond
        5. if tool_calls → execute in parallel, stream to EventStore
        6. drain queued prompts
        7. if tool_calls or queued prompts → go to 1, else stop
```

### Compaction Loop

Same loop, `mode: 'compaction'`. Only difference:

- Tool calls are rejected: "Compaction in progress — only produce a summary"
- On completion: create new context window, set summary as first message

---

## Current State Analysis

### What Already Works

| Concern                                | Location                                                         | Status   |
| -------------------------------------- | ---------------------------------------------------------------- | -------- |
| EventStore as SSOT                     | `src/server/events/store.ts`                                     | ✅ Solid |
| Streaming LLM (pure generator)         | `src/server/chat/stream-pure.ts`                                 | ✅ Solid |
| Parallel tool execution                | `src/server/chat/agent-loop.ts` `executeToolBatch()`             | ✅ Works |
| Context building from events           | `src/server/chat/conversation-history.ts`                        | ✅ Works |
| Context size tracking via promptTokens | `src/server/session/manager.ts` `setCurrentContextSize()`        | ✅ Works |
| AbortSignal interruption               | Throughout                                                       | ✅ Works |
| Agent mode reminders                   | `src/server/chat/orchestrator.ts` `injectModeReminderIfNeeded()` | ✅ Works |

### What Needs to Change

| Concern                     | Current                                           | Target                                        |
| --------------------------- | ------------------------------------------------- | --------------------------------------------- |
| Compaction code path        | Separate function, different assembly             | Same loop, `mode: 'compaction'` flag          |
| Compaction tool handling    | Allows tool calls                                 | Rejects tool calls with message               |
| Context threshold check     | At start of iteration, uses stale `currentTokens` | After LLM response, uses fresh `promptTokens` |
| Event removal on compaction | Never removes events                              | Tombstone support in EventStore               |
| `isRunning` management      | Set externally by caller                          | Managed by orchestrator wrapping the loop     |
| System prompt caching       | Updated inside the loop                           | Decoupled, updated independently              |
| Auto-loop patterns          | Only XML format retries, hardcoded                | Configurable pattern matching                 |
| Vision fallback             | Inline during streaming, same LLM client          | Delegated to configured vision model          |
| Attachment stripping        | Not done                                          | Strip from history if model lacks vision      |

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Orchestrator                       │
│  • manages isRunning (true/false)                    │
│  • creates AbortController                           │
│  • reads events from EventStore                      │
│  • provides append() to the loop                     │
│  • sinks all events to EventStore                    │
│  • handles errors, snapshots                         │
│  • manages system prompt cache (decoupled)           │
└──────────────────────┬──────────────────────────────┘
                       │ calls with:
                       │   append(event)  ← the only write path
                       │   events[]       ← current state snapshot
                       ▼
┌─────────────────────────────────────────────────────┐
│                   Agent Loop                          │
│  • pure control flow (if/else over decisions)        │
│  • composes sub-functions                            │
│  • never imports EventStore directly                 │
│  • parameterized by mode: 'normal' | 'compaction'    │
└──────┬──────────┬──────────┬──────────┬─────────────┘
       │          │          │          │
       ▼          ▼          ▼          ▼
   buildCtx   streamLLM  execTools  drainQueue
   (pure)     (append)   (append)   (returns)
```

### Data Flow

```
Orchestrator                    Agent Loop                   Sub-function
    │                              │                              │
    ├─ eventStore.getEvents() ────►│                              │
    │                              ├─ buildContext(events) ─────►│
    │                              │◄── ContextMessage[] ────────┤
    │                              │                              │
    │                              ├─ streamLLM(append, ...) ───►│
    │                              │   append(delta) ────────────►│  (real-time)
    │◄── append(delta) ───────────┤                              │
    │  eventStore.append(delta)    │                              │
    │                              │◄── StreamResult ────────────┤
    │                              │                              │
    │                              ├─ shouldCompact(pt, max) ────►│
    │                              │◄── boolean ─────────────────┤
    │                              │                              │
    │                              ├─ execTools(append, ...) ───►│
    │                              │   append(progress) ─────────►│  (real-time)
    │◄── append(progress) ────────┤                              │
    │                              │◄── ToolResult[] ────────────┤
    │                              │                              │
    │                              ├─ drainQueue() ─────────────►│
    │                              │◄── QueuedMessage[] ─────────┤
    │                              │                              │
    │                              └── continue or break ────────┘
    │
    └─ eventStore.append(snapshot)
```

---

## Sub-Function Contracts

### 1. `buildContext(events, scope) → ContextMessage[]`

**Pure.** Reads events, returns LLM-ready messages.

```ts
function buildContext(events: StoredEvent[], scope: ConversationScope): ContextMessage[]
```

- Already exists as `getConversationMessages()` in `conversation-history.ts`
- Test: give events, assert messages

### 2. `streamLLM(append, client, messages, tools) → Promise<StreamResult>`

**Impure (append).** Streams LLM response, pushes delta events in real-time.

```ts
interface StreamResult {
  thinking?: string
  content?: string
  toolCalls: ToolCall[]
  usage: { promptTokens: number; completionTokens: number }
  finishReason: string
}

async function streamLLM(
  append: (event: TurnEvent) => void,
  client: LLMClientWithModel,
  messages: ContextMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal,
): Promise<StreamResult>
```

- Already exists as `streamLLMPure` + `consumeStreamGenerator`
- Test: mock client, assert events passed to append + returned result

### 3. `shouldCompact(promptTokens, maxTokens, threshold) → boolean`

**Pure.**

```ts
function shouldCompact(promptTokens: number, maxTokens: number, threshold: number): boolean
```

- Already exists as `shouldCompact()` in `compactor.ts`
- Trivial to test

### 4. `matchAutoPatterns(content, thinking, patterns) → AutoMatch[]`

**Pure.** Compares response against configured patterns.

```ts
interface AutoPattern {
  match: RegExp | ((content: string, thinking?: string) => boolean)
  response: string // auto-injected message content
}

interface AutoMatch {
  pattern: AutoPattern
  response: string
}

function matchAutoPatterns(content: string, thinking: string | undefined, patterns: AutoPattern[]): AutoMatch[]
```

- Doesn't exist yet
- Replaces hardcoded XML format retry logic

### 5. `executeTools(append, toolCalls, ctx) → Promise<ToolExecutionResult>`

**Impure (append).** Executes tools in parallel, streams progress.

```ts
interface ToolExecutionResult {
  toolMessages: RequestContextMessage[]
  returnValue?: { content?: string; result?: string }
}

async function executeTools(
  append: (event: TurnEvent) => void,
  toolCalls: ToolCall[],
  ctx: ToolBatchContext,
): Promise<ToolExecutionResult>
```

- Already exists as `executeToolBatch()` in `agent-loop.ts`
- Needs to be extracted and accept `append` instead of importing EventStore

### 6. `drainQueue(manager, sessionId) → QueuedMessage[]`

**Impure (reads session manager).** Drains ASAP messages.

```ts
function drainQueue(manager: SessionManager, sessionId: string): QueuedMessage[]
```

- Already exists as `sessionManager.drainAsapMessages()`
- Returns messages to be appended as events by the loop

### 7. `compactionLoop(append, events, deps) → Promise<void>`

Same loop as agentLoop, `mode: 'compaction'`.

```ts
async function compactionLoop(
  append: (event: TurnEvent) => void,
  events: StoredEvent[],
  deps: CompactionDeps,
): Promise<void>
```

- Tool calls → append rejection message + loop
- No tool calls → append summary + `context.compacted` event

---

## Orchestrator Responsibilities

```ts
async function runOrchestrator(sessionId: string, deps: OrchestratorDeps): Promise<void> {
  const controller = new AbortController()
  const append = (event: TurnEvent) => deps.eventStore.append(sessionId, event)

  append({ type: 'running.changed', data: { isRunning: true } })

  try {
    const events = deps.eventStore.getEvents(sessionId)
    await agentLoop({ append, events, signal: controller.signal, ...deps })
  } catch (error) {
    if (error instanceof Error && error.message !== 'Aborted') {
      append({ type: 'chat.error', data: { error: error.message, recoverable: false } })
    }
  } finally {
    append({ type: 'running.changed', data: { isRunning: false } })
    append({ type: 'turn.snapshot', data: buildSnapshot(...) })
    deps.eventStore.cleanupOldEvents(sessionId)
  }
}
```

---

## The Agent Loop

```ts
type LoopMode = 'normal' | 'compaction'

interface LoopContext {
  append: (event: TurnEvent) => void
  events: StoredEvent[]
  mode: LoopMode
  client: LLMClientWithModel
  signal?: AbortSignal
  maxTokens: number
  compactionThreshold: number
  autoPatterns: AutoPattern[]
  toolRegistry: ToolRegistry
  sessionManager: SessionManager
  sessionId: string
  workdir: string
}

async function agentLoop(ctx: LoopContext): Promise<void> {
  const scope: ConversationScope = { type: 'toplevel', sessionId: ctx.sessionId }

  for (;;) {
    if (ctx.signal?.aborted) throw new Error('Aborted')

    // 1. Build context from events
    const messages = buildContext(ctx.events, scope)

    // 2. Stream LLM
    const response = await streamLLM(ctx.append, ctx.client, messages, ctx.toolRegistry.definitions, ctx.signal)

    // 3. Check compaction threshold (only in normal mode)
    if (ctx.mode === 'normal' && shouldCompact(response.usage.promptTokens, ctx.maxTokens, ctx.compactionThreshold)) {
      await handleCompaction(ctx)
      continue
    }

    // 4. Match auto-loop patterns
    const matches = matchAutoPatterns(response.content, response.thinking, ctx.autoPatterns)
    if (matches.length > 0) {
      for (const match of matches) {
        appendAutoResponse(ctx.append, match.response, ctx.sessionId)
      }
      continue
    }

    // 5. Handle tool calls
    if (response.toolCalls.length > 0) {
      if (ctx.mode === 'compaction') {
        await handleCompactionToolRejection(ctx, response.toolCalls)
        continue
      }

      const result = await executeTools(ctx.append, response.toolCalls /* ... */)

      // 6. Drain queued prompts
      const queued = drainQueue(ctx.sessionManager, ctx.sessionId)
      for (const msg of queued) {
        appendQueuedMessage(ctx.append, msg, ctx.sessionId)
      }

      if (result.toolMessages.length > 0 || queued.length > 0) continue
    }

    break
  }

  // Finalize in normal mode
  if (ctx.mode === 'normal') {
    appendMessageDone(ctx.append /* ... */)
    appendChatDone(ctx.append /* ... */)
  }
}
```

---

## Testing Strategy

### Sub-functions (unit tests)

Each sub-function is tested in isolation:

```ts
// Pure: give input, assert output
test('buildContext filters by context window', () => {
  const messages = buildContext(mockEvents, { type: 'toplevel', sessionId: 's1' })
  expect(messages).toHaveLength(3)
  expect(messages[0]!.role).toBe('user')
})

test('shouldCompact triggers at 80%', () => {
  expect(shouldCompact(8000, 10000, 0.8)).toBe(true)
  expect(shouldCompact(7000, 10000, 0.8)).toBe(false)
})

// Impure: assert on append calls
test('streamLLM emits deltas via append', async () => {
  const append = vi.fn()
  const result = await streamLLM(append, mockClient, messages, tools)
  expect(append).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.delta' }))
  expect(result.content).toBe('Hello')
})

test('executeTools runs in parallel and appends results', async () => {
  const append = vi.fn()
  const result = await executeTools(append, toolCalls, mockCtx)
  expect(append).toHaveBeenCalledTimes(2) // tool.call + tool.result
})
```

### Agent Loop (integration tests)

Mock sub-functions, assert control flow:

```ts
test('loop continues when tool calls are returned', async () => {
  const append = vi.fn()
  const events = createMockEvents()

  await agentLoop({
    append,
    events,
    mode: 'normal',
    // mock streamLLM to return tool calls on first call, content on second
    streamLLM: vi
      .fn()
      .mockResolvedValueOnce({ toolCalls: [mockToolCall], usage: { promptTokens: 100 } })
      .mockResolvedValueOnce({ content: 'Done', toolCalls: [], usage: { promptTokens: 200 } }),
    executeTools: vi.fn().mockResolvedValue({ toolMessages: [mockToolMsg] }),
    drainQueue: vi.fn().mockReturnValue([]),
    shouldCompact: vi.fn().mockReturnValue(false),
  })

  expect(append).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool.call' }))
  expect(append).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.done' }))
})

test('compaction loop rejects tool calls', async () => {
  const append = vi.fn()

  await agentLoop({
    append,
    events,
    mode: 'compaction',
    streamLLM: vi
      .fn()
      .mockResolvedValueOnce({ toolCalls: [mockToolCall], usage: { promptTokens: 100 } })
      .mockResolvedValueOnce({ content: 'Summary', toolCalls: [], usage: { promptTokens: 200 } }),
  })

  expect(append).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'message.start',
      data: expect.objectContaining({
        content: expect.stringContaining('Compaction in progress'),
      }),
    }),
  )
})
```

---

## Migration Path

### Phase 1: Extract sub-functions (no behavior change)

1. Extract `executeTools()` from `agent-loop.ts` — accepts `append`, no EventStore import
2. Extract `drainQueue()` as standalone function
3. Extract `matchAutoPatterns()` — initially just the XML format check
4. Create `shouldCompact()` wrapper that uses fresh `promptTokens`

### Phase 2: Parameterize the loop

5. Add `mode: 'normal' | 'compaction'` parameter to `agentLoop`
6. Move compaction logic into the loop with `mode: 'compaction'`
7. Add tombstone support to EventStore

### Phase 3: Decouple orchestrator

8. Extract `runOrchestrator()` that manages isRunning, abort, append
9. Move system prompt caching out of the loop
10. Add configurable auto-patterns

### Phase 4: Clean up

11. Remove dead code paths
12. Add integration tests for the loop
13. Document sub-function contracts

---

## Key Principles

1. **The loop never imports EventStore** — it receives `append()` and `events[]`
2. **Pure functions are tested by assertion** — give input, check output
3. **Impure functions are tested by mock** — assert on `append()` calls
4. **Compaction is a mode, not a separate path** — same loop, different flag
5. **System prompt caching is the orchestrator's problem** — the loop doesn't touch it
6. **`isRunning` is the orchestrator's problem** — set true before, false in finally
