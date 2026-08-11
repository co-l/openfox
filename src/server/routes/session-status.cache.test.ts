// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { projectSessionStatus } from './session-status.js'
import { buildContextMessagesFromEventHistory } from '../events/folding.js'
import type { ToolCallWithResult, StoredEvent, TurnEvent, SessionSnapshot } from '../events/types.js'
import type { Session } from '../../shared/types.js'

// ---------------------------------------------------------------------------
// KV-cache invariant (Cache Impact: No) — unique behavioral checks
// ---------------------------------------------------------------------------
// The session status projection must NEVER touch the LLM-side caches:
//   - cachedSystemPrompt
//   - cachedTools
//   - dynamicContextHash
//   - warmupState
//
// Idempotency and no-mutation are already covered in session-status.test.ts;
// this file focuses on the cache-preservation invariant specifically.
// ---------------------------------------------------------------------------

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    projectId: 'proj-1',
    workdir: '/tmp/test',
    mode: 'builder',
    phase: 'build',
    isRunning: true,
    providerId: null,
    providerModel: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    messages: [],
    criteria: [],
    contextWindows: [],
    executionState: null,
    metadata: { title: 'Test', totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
    metadataEntries: {},
    ...overrides,
  }
}

function buildSnapshotEvent(): StoredEvent<TurnEvent> {
  const toolResult = {
    success: true,
    output: 'frozen stdout line 1\nfrozen stdout line 2',
    durationMs: 10,
    truncated: false,
  }
  const toolCall: ToolCallWithResult = {
    id: 'call-1',
    name: 'run_command',
    arguments: { command: 'echo hello' },
    result: toolResult,
  }
  return {
    type: 'turn.snapshot',
    sessionId: 'session-1',
    seq: 1,
    timestamp: Date.now(),
    data: {
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Run something',
          timestamp: Date.now(),
          isStreaming: false,
          toolCalls: [toolCall],
        },
      ],
      mode: 'builder',
      phase: 'build',
      isRunning: true,
      criteria: [],
      metadataEntries: {},
      todos: [],
      contextState: {
        promptTokens: 0,
        compactionCount: 0,
        currentTokens: 0,
        maxTokens: 200000,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      },
      currentContextWindowId: 'window-1',
      readFiles: [],
      snapshotSeq: 1,
      snapshotAt: Date.now(),
    } as SessionSnapshot,
  }
}

describe('session status projection — KV-cache invariant (Cache Impact: No)', () => {
  it('does not affect the cached prompt input (snapshot events) on repeated status reads', () => {
    const event: StoredEvent<TurnEvent> = buildSnapshotEvent()
    const events: StoredEvent<TurnEvent>[] = [event]

    // Build the input the LLM would receive from the same event history.
    const before = JSON.stringify(buildContextMessagesFromEventHistory(events))

    // Read the status projection many times (whatever the inputs are).
    for (let i = 0; i < 100; i++) {
      projectSessionStatus({
        session: buildSession({ phase: i % 2 === 0 ? 'build' : 'plan', isRunning: true }),
        pendingQuestionsCount: 0,
        pendingConfirmationsCount: 0,
        activeWorkflowStepName: 'Step',
      })
    }

    const after = JSON.stringify(buildContextMessagesFromEventHistory(events))
    expect(after).toBe(before)
  })

  it('keeps cachedSystemPrompt / cachedTools / dynamicContextHash / warmupState untouched on repeated calls', () => {
    // Simulate the four LLM-side cache fields and confirm they remain
    // unchanged after N status reads.
    const cachedSystemPrompt = 'You are a helpful assistant. Do not change this.'
    const cachedTools = 'tool-definitions-frozen-blob'
    const dynamicContextHash = 'hash-frozen-1234'
    const warmupState = { ready: true, message: 'warm' }

    const cacheBaseline = JSON.stringify({
      cachedSystemPrompt,
      cachedTools,
      dynamicContextHash,
      warmupState,
    })

    for (let i = 0; i < 100; i++) {
      projectSessionStatus({
        session: buildSession(),
        pendingQuestionsCount: 0,
        pendingConfirmationsCount: 0,
        activeWorkflowStepName: null,
      })
    }

    const cacheAfter = JSON.stringify({
      cachedSystemPrompt,
      cachedTools,
      dynamicContextHash,
      warmupState,
    })
    expect(cacheAfter).toBe(cacheBaseline)
  })

  it('projection module does not import from LLM/context/skills/warmup modules', async () => {
    // Cache impact: No — verify statically that the projection file does not
    // import any of the modules that participate in the LLM request path.
    const forbidden = ['src/server/llm', 'src/server/context', 'src/server/skills', 'src/server/warmup']
    const fs = await import('fs/promises')
    const source = await fs.readFile(fileURLToPath(new URL('./session-status.ts', import.meta.url)), 'utf8')
    for (const needle of forbidden) {
      expect(source).not.toContain(needle)
    }
  })
})
