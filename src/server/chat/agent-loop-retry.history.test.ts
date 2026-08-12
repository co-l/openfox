/**
 * Agent Loop – Retry History (real EventStore + real streamLLMPure)
 *
 * Drives runTopLevelAgentLoop end-to-end against a real EventStore with a
 * scripted LLM client, verifying the two failure shapes end-to-end:
 *   - Case 1: request fails before content → nothing written; retry succeeds.
 *   - Case 2: mid-stream failure → partial kept + exactly one continuation,
 *     then the retry continues.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import type { LLMStreamEvent, LLMCompletionResponse } from '../llm/types.js'
import { EventStore } from '../events/store.js'
import type { TurnMetrics } from './stream-pure.js'
import type { TopLevelLoopConfig } from './agent-loop.js'

vi.mock('../events/index.js', () => ({
  getCurrentContextWindowId: vi.fn(() => undefined),
  getCurrentWindowMessageOptions: vi.fn(() => undefined),
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: vi.fn(),
}))

vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn().mockReturnValue({
    mode: 'test',
    workdir: '/test',
    context: { compactionThreshold: 800000 },
    llm: {
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      timeout: 30000,
      idleTimeout: 30000,
      backend: 'ollama',
    },
  }),
}))

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn().mockReturnValue('/test/config'),
}))

vi.mock('../context/compactor.js', () => ({
  shouldCompact: vi.fn(() => false),
  appendCompactionPrompt: vi.fn(),
}))

vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn(async () => []),
  getSubAgents: vi.fn(() => []),
}))

vi.mock('../drain-queue.js', () => ({
  drainQueue: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { runTopLevelAgentLoop } from './agent-loop.js'

const FAST_POLICY = { backoffMs: [0, 0, 0, 0], minIntervalMs: 0, maxDurationMs: 60_000, maxAttempts: 40 }

const okResponse: LLMCompletionResponse = {
  id: 'resp-ok',
  content: '',
  toolCalls: [],
  finishReason: 'stop',
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
}

/** LLM client serving one event batch per stream() call (attempt). */
function createSequencedClient(...eventSets: LLMStreamEvent[][]) {
  let attempt = 0
  return {
    complete: async () => {
      throw new Error('Not implemented')
    },
    getModel: () => 'test-model',
    getProfile: () => ({}) as never,
    getBackend: () => 'unknown' as const,
    setBackend: () => {},
    setModel: () => {},
    stream: async function* () {
      const events = eventSets[Math.min(attempt, eventSets.length - 1)]!
      attempt += 1
      for (const event of events) {
        yield event
      }
    },
  }
}

describe('agent loop retry history (real EventStore)', () => {
  let db: Database.Database
  let store: EventStore
  let mockSessionManager: any
  let mockTurnMetrics: TurnMetrics

  beforeEach(async () => {
    vi.clearAllMocks()
    db = new Database(':memory:')
    store = new EventStore(db)
    db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, is_running INTEGER DEFAULT 0, updated_at INTEGER)`,
    )
    store.append('session-1', { type: 'message.start', data: { messageId: 'user-1', role: 'user', content: 'hi' } })
    store.append('session-1', { type: 'message.done', data: { messageId: 'user-1' } })

    mockSessionManager = {
      requireSession: vi.fn().mockReturnValue({
        workdir: '/test',
        projectId: 'test-project',
        executionState: null,
        criteria: [],
        isRunning: false,
      }),
      getEffectiveWorkdir: vi.fn().mockReturnValue('/test'),
      getProjectWorkdir: vi.fn().mockReturnValue('/test'),
      getContextState: vi.fn().mockReturnValue({
        currentTokens: 0,
        maxTokens: 128000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(128000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 4096 }),
      getModelCompactionThreshold: vi.fn().mockReturnValue(800000),
      setCurrentContextSize: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
    }
    mockTurnMetrics = {
      addToolTime: vi.fn(),
      addLLMCall: vi.fn(),
      buildStats: vi.fn().mockReturnValue({ durationMs: 0 }),
    } as unknown as TurnMetrics

    const { getAllInstructions } = await import('../context/instructions.js')
    const { getEnabledSkillMetadata } = await import('../skills/registry.js')
    ;(getAllInstructions as any).mockResolvedValue({ content: 'test instructions', files: [] })
    ;(getEnabledSkillMetadata as any).mockResolvedValue([])
  })

  afterEach(() => {
    db.close()
  })

  function makeConfig(overrides?: Partial<TopLevelLoopConfig>): TopLevelLoopConfig {
    return {
      mode: 'planner',
      append: (event) => store.append('session-1', event),
      sessionManager: mockSessionManager,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'test-model' } as never,
      statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'test-model' },
      assembleRequest: vi.fn().mockResolvedValue({ systemPrompt: 'sys', messages: [], tools: [] }),
      getToolRegistry: () => ({ tools: [], definitions: [], execute: vi.fn() }) as any,
      getConversationMessages: vi.fn().mockResolvedValue([]),
      ...overrides,
    }
  }

  it('case 1 — failed-before-content retry writes nothing, success writes the exact expected events', async () => {
    const client = createSequencedClient(
      [{ type: 'error', error: 'boom' }],
      [
        { type: 'text_delta', content: 'ok' },
        { type: 'done', response: okResponse },
      ],
    )

    const config = makeConfig({ llmClient: client as never, llmRetryPolicy: FAST_POLICY })
    const result = await runTopLevelAgentLoop(config, mockTurnMetrics)

    expect(result.failed).toBeUndefined()
    const events = store.getEvents('session-1').map((e) => e.type)
    // Seed user message + only the successful attempt's assistant message
    expect(events).toEqual([
      'message.start',
      'message.done',
      'message.start',
      'message.delta',
      'message.done',
      'chat.done',
    ])
    const delta = store.getEvents('session-1')[3]!
    expect((delta.data as { content: string }).content).toBe('ok')
  })

  it('case 2 — keeps partial content plus exactly one continuation, then retries', async () => {
    const client = createSequencedClient(
      [
        { type: 'text_delta', content: 'partial ' },
        { type: 'error', error: 'stream died' },
      ],
      [
        { type: 'text_delta', content: 'final' },
        { type: 'done', response: okResponse },
      ],
    )

    const config = makeConfig({ llmClient: client as never, llmRetryPolicy: FAST_POLICY })
    const result = await runTopLevelAgentLoop(config, mockTurnMetrics)

    expect(result.failed).toBeUndefined()
    const events = store.getEvents('session-1')
    const types = events.map((e) => e.type)
    // Seed + partial attempt (kept) + one continuation + successful retry
    expect(types).toEqual([
      'message.start',
      'message.done',
      // partial attempt: assistant start + delta + done(partial)
      'message.start',
      'message.delta',
      'message.done',
      // continuation user message
      'message.start',
      'message.done',
      // successful retry
      'message.start',
      'message.delta',
      'message.done',
      'chat.done',
    ])
    const partialDone = events[4]!
    expect((partialDone.data as { partial?: boolean }).partial).toBe(true)
    const continueMsg = events[5]!
    expect((continueMsg.data as { content?: string }).content).toContain('interrupted')
    // No chat.error, nothing removed
    expect(types.includes('chat.error')).toBe(false)
    const finalDelta = events[8]!
    expect((finalDelta.data as { content: string }).content).toBe('final')
  })
})
