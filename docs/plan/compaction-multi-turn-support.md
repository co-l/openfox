# Compaction Multi-Turn Support Plan

## Problem Statement

The current compaction implementation in `auto-compaction.ts` fails when the agent takes multiple turns to complete the summary. This happens because:

1. **`consumeStreamGenerator()` only processes one LLM response** - It calls `streamLLMPure()` once and returns after the first response, ignoring any tool calls the model might make.

2. **`toolChoice: 'none'` causes KV-cache invalidation** - When context is largest (worst time), the system prompt is moved out of cache prefix.

3. **Missing tool execution loop** - The code doesn't execute tools or loop back for follow-up responses.

---

## Goals

1. **Handle multi-turn agent responses** - Agent can use tools to provide better summaries (e.g., read files to verify changes)
2. **Preserve KV-cache** - Use `toolChoice: 'auto'` so system prompt stays in cache prefix
3. **Create reusable component** - New function can be reused for other single-agent tasks that need multi-turn support

---

## Architecture

### Current Flow

```
auto-compaction.ts:
  streamLLMPure({ toolChoice: 'none', ... })
    → consumeStreamGenerator()  // Returns after FIRST response only
    → result.content = summary
```

### Target Flow

```
auto-compaction.ts:
  consumeStreamWithToolLoop({
    messageId,
    systemPrompt,
    llmClient,
    messages: [...llmMessages, ...correctionMessages],
    tools: toolRegistry.definitions,
    toolChoice: 'auto',        // Changed: preserve KV cache
    disableThinking: true,
    signal,
    onEvent: (event) => eventStore.append(sessionId, event)
  })
    → LOOP:
      streamLLMPure() → consume
      if (result.toolCalls.length > 0)
        executeToolBatch()
        continue
      else
        return result  // Final content
```

---

## Implementation Steps

### Step 1: Create `consumeStreamWithToolLoop()` in `stream-pure.ts`

Location: `src/server/chat/stream-pure.ts`

New export function:

```typescript
export interface ConsumeStreamWithToolLoopOptions {
  messageId: string
  systemPrompt: string
  llmClient: LLMClientWithModel
  messages: RequestContextMessage[]
  tools: LLMToolDefinition[]
  toolChoice: 'auto' | 'none' | 'required'
  disableThinking?: boolean
  signal?: AbortSignal
  turnMetrics: TurnMetrics
  toolRegistry: ToolRegistry
  sessionId: string
  workdir: string
  onEvent: (event: TurnEvent) => void
  statsIdentity: StatsIdentity
  dangerLevel?: DangerLevel
}

export async function consumeStreamWithToolLoop(
  options: ConsumeStreamWithToolLoopOptions
): Promise<PureStreamResult>
```

### Step 2: Implement the loop logic

```typescript
const MAX_TOOL_LOOP_ITERATIONS = 10

export async function consumeStreamWithToolLoop(
  options: ConsumeStreamWithToolLoopOptions
): Promise<PureStreamResult> {
  const {
    messageId, systemPrompt, llmClient, messages, tools, toolChoice,
    disableThinking, signal, turnMetrics, toolRegistry, sessionId,
    workdir, onEvent, statsIdentity, dangerLevel
  } = options

  // Build LLM messages with system prompt
  const systemMsg = { role: 'system' as const, content: systemPrompt }
  let currentMessages = [systemMsg, ...messages]

  let iterations = 0
  for (;;) {
    // Check abort before each iteration
    if (signal?.aborted) {
      return {
        content: '',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
        aborted: true,
        xmlFormatError: false,
      }
    }

    // Check max iterations
    if (++iterations > MAX_TOOL_LOOP_ITERATIONS) {
      throw new Error('Max tool loop iterations exceeded during compaction')
    }

    // Stream one turn
    const streamGen = streamLLMPure({
      messageId,
      systemPrompt: '',  // Already in currentMessages
      llmClient,
      messages: currentMessages,
      tools,
      toolChoice,
      disableThinking,
      signal,
      // No vision fallback needed - compaction doesn't handle images
    })

    const result = await consumeStreamGenerator(streamGen, onEvent)

    if (result.aborted) {
      return result
    }

    if (result.xmlFormatError) {
      // Add correction prompt and retry within same iteration
      const correctionMsg = { role: 'user' as const, content: FORMAT_CORRECTION_PROMPT }
      currentMessages = [...currentMessages, correctionMsg]
      continue
    }

    turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)

    // Execute tools if present
    if (result.toolCalls.length > 0) {
      // Emit message.done before tool execution
      const stats = turnMetrics.buildStats(statsIdentity, 'compaction')
      onEvent(createMessageDoneEvent(messageId, {
        segments: result.segments,
        stats,
        promptContext: undefined,
      }))

      // Execute tool batch
      const toolContext = {
        toolRegistry,
        sessionManager: null,  // Not needed - we have sessionId directly
        sessionId,
        workdir,
        turnMetrics,
        signal,
        llmClient,
        statsIdentity,
        dangerLevel,
      }

      const toolResult = await executeToolBatch(messageId, result.toolCalls, toolContext)

      // Add tool results to messages for next turn
      for (const toolMsg of toolResult.toolMessages) {
        currentMessages.push({
          role: 'tool' as const,
          content: toolMsg.content,
          toolCallId: toolMsg.toolCallId,
        })
      }

      // Add assistant response to messages
      currentMessages.push({
        role: 'assistant' as const,
        content: result.content,
        toolCalls: result.toolCalls,
      })

      continue  // Loop for next turn
    }

    // No tool calls - return final result
    // If content is empty, fall back to thinking content (for Ollama/MiniMax models)
    if (!result.content && result.thinkingContent) {
      return {
        ...result,
        content: result.thinkingContent,
      }
    }

    return result
  }
}
```

### Step 3: Refactor `executeToolBatch()` for reuse

The current `executeToolBatch()` in `agent-loop.ts` has tight coupling to `SessionManager`. We need to make it work with just `sessionId` for the compaction case.

Option A: Pass optional `sessionManager` (can be null)
Option B: Create a simpler version that accepts `sessionId` directly

Recommendation: Option A (minimal changes)

Changes needed in `agent-loop.ts`:

```typescript
// Line 119 - add null check
let session = ctx.sessionManager 
  ? ctx.sessionManager.requireSession(ctx.sessionId)
  : null

// Line 156 - get lspManager only if sessionManager exists
const lspManager = ctx.sessionManager?.getLspManager(ctx.sessionId)

// Line 221 - add null check
const updatedSession = ctx.sessionManager
  ? ctx.sessionManager.requireSession(ctx.sessionId)
  : null
```

### Step 4: Update `auto-compaction.ts` to use new function

```typescript
// In performContextCompaction():
import { consumeStreamWithToolLoop } from '../chat/stream-pure.js'
import { executeToolBatch } from '../chat/agent-loop.js'

// Replace the loop (lines 184-227)
const turnMetrics = new TurnMetrics()

const result = await consumeStreamWithToolLoop({
  messageId: assistantMsgId,
  systemPrompt: assembledRequest.systemPrompt,
  llmClient,
  messages: llmMessages,
  tools: toolRegistry.definitions,
  toolChoice: 'auto',  // Changed from 'none' - preserve KV cache
  disableThinking: true,
  signal,
  turnMetrics,
  toolRegistry,
  sessionId,
  workdir: session.workdir,
  onEvent: (event) => eventStore.append(sessionId, event),
  statsIdentity,
  dangerLevel: session.dangerLevel,
})

// Remove the old loop - result already has final content
// No need for format retry loop - consumeStreamWithToolLoop handles it
```

### Step 5: Update COMPACTION_PROMPT in `prompts.ts`

Remove the "do not use any tools" instruction - tools are now allowed and encouraged for better summaries.

```typescript
export const COMPACTION_PROMPT = `Summarize the conversation history concisely, preserving:
1. All file modifications made (file paths and what changed)
2. All errors encountered and how they were resolved
3. Current progress on each task
4. Any important decisions or learnings
5. Next steps or pending actions that should be continued after compaction
6. The user's current question, prompt, or active request

Be thorough but concise. Output as a structured summary.
You may use available tools to read files and verify changes if needed.`
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/server/chat/stream-pure.ts` | Add `consumeStreamWithToolLoop()` export |
| `src/server/chat/agent-loop.ts` | Add null checks in `executeToolBatch()` for optional sessionManager |
| `src/server/context/auto-compaction.ts` | Replace loop with new function, change `toolChoice: 'auto'` |
| `src/server/chat/prompts.ts` | Update COMPACTION_PROMPT to allow tools |

---

## Testing Strategy

### Unit Tests
- `stream-pure.test.ts`: Test multi-turn loop handles tool calls correctly
- `stream-pure.test.ts`: Test format error retry behavior
- `stream-pure.test.ts`: Test abort signal propagation
- `stream-pure.test.ts`: Test max iteration cap enforcement

### E2E Tests
- `e2e/auto-compaction.test.ts`: Existing tests should pass
- Add new test: Agent uses tools during compaction and produces valid summary

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Tool execution in compaction context causes issues | Use read-only tools initially; review tool registry |
| Performance regression (more LLM calls) | Cache system prompt; only multi-turn when needed |
| Breaking existing behavior | Keep `consumeStreamGenerator` unchanged; new function is additive |
| Infinite loops | MAX_TOOL_LOOP_ITERATIONS = 10 cap enforced |

---

## Alternative Considered: Option B (Single-shot)

Using `llmClient.complete()` directly (like `summary-generator.ts`):

- **Pros**: Simpler, faster, no loop complexity
- **Cons**: Loses ability to use tools for better summaries, still has KV-cache issue

**Decision**: Option A preferred because:
1. Tools can improve summary quality (verify file changes)
2. Fixes KV-cache invalidation bug
3. Reusable for other single-agent tasks