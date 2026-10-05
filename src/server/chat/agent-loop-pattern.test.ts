/**
 * Agent Loop – Auto-Retry Patterns (real EventStore + real streamLLMPure)
 *
 * Verifies that user-configured retry patterns work inside a sub-agent run:
 *   - the mid-stream match emits pattern.retry + a "correction" message, and
 *     the continuation prompt, both scoped to the sub-agent (subAgentId /
 *     subAgentType) so the sub-agent's own context keeps them;
 *   - the parent's top-level context excludes them (no cross-contamination);
 *   - the retry cap is enforced: exhausting it emits chat.error +
 *     chat.done(agentType 'sub-agent') and throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import type { LLMStreamEvent, LLMCompletionResponse } from '../llm/types.js'
import { EventStore } from '../events/store.js'
import type { RequestContextMessage } from './request-context.js'
import type { TurnMetrics } from './stream-pure.js'
import type { TopLevelLoopConfig } from './agent-loop.js'
import { buildContextMessagesFromStoredEvents } from '../events/folding.js'
import { createAssemblyResult } from './request-context.js'
import { getConversationMessages, type SubAgentScope } from './conversation-history.js'

const { getEventStoreMock } = vi.hoisted(() => ({ getEventStoreMock: vi.fn() }))

vi.mock('../events/index.js', () => ({
  getEventStore: getEventStoreMock,
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
    agent: { toolTimeout: 120000 },
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

const XML_PATTERN = '<(tool_call|function=|/tool_call|parameter=)'

interface LLMRequest {
  messages: Array<{ role: string; content: string }>
}

/** LLM client serving one event set per stream() call (attempt), logging requests. */
function createSequencedClient(requestLog: LLMRequest[], ...eventSets: LLMStreamEvent[][]) {
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
    stream: async function* (request: LLMRequest) {
      requestLog.push(request)
      const events = eventSets[Math.min(attempt, eventSets.length - 1)]!
      attempt += 1
      for (const event of events) {
        yield event
      }
    },
  }
}

function createReturnValueEvents(): LLMStreamEvent[] {
  const response: LLMCompletionResponse = {
    id: 'resp-rv',
    content: 'Completed.',
    toolCalls: [{ id: 'call-1', name: 'return_value', arguments: { content: 'Done exploring', result: 'success' } }],
    finishReason: 'tool_calls',
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
  }
  return [
    {
      type: 'tool_call_delta',
      index: 0,
      id: 'call-1',
      name: 'return_value',
      arguments: '{"content":"Done exploring","result":"success"}',
    },
    { type: 'text_delta', content: 'Completed.' },
    { type: 'done', response },
  ]
}

describe('agent loop pattern retry (real EventStore)', () => {
  let db: Database.Database
  let store: EventStore
  let mockSessionManager: any
  let mockTurnMetrics: TurnMetrics
  const subAgentScope: SubAgentScope = {
    type: 'subagent',
    sessionId: 'session-1',
    subAgentId: 'sub-1',
    subAgentType: 'explorer',
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    db = new Database(':memory:')
    store = new EventStore(db)
    db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, is_running INTEGER DEFAULT 0, updated_at INTEGER)`,
    )
    // Seed a sub-agent-scoped user message (mirrors the manager's auto-prompt)
    store.append('session-1', {
      type: 'message.start',
      data: {
        messageId: 'user-1',
        role: 'user',
        content: 'Explore the codebase',
        subAgentId: 'sub-1',
        subAgentType: 'explorer',
      },
    })
    store.append('session-1', { type: 'message.done', data: { messageId: 'user-1' } })

    mockSessionManager = {
      enterPauseGate: vi.fn().mockResolvedValue('released'),
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
      getSubAgentContextTokens: vi.fn().mockReturnValue(0),
      setCurrentContextSize: vi.fn(),
      getLspManager: vi.fn().mockReturnValue(undefined),
      drainAsapMessages: vi.fn().mockReturnValue([]),
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
      mode: 'explorer',
      append: (event) => store.append('session-1', event),
      sessionManager: mockSessionManager,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'test-model' } as never,
      statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'test-model' },
      assembleRequest: vi.fn(
        async (input: {
          messages: import('./request-context.js').RequestContextMessage[]
          injectedFiles: import('../../shared/types.js').InjectedFile[]
          promptTools: import('../llm/types.js').LLMToolDefinition[]
          toolChoice: 'auto' | 'none' | 'required'
        }) =>
          createAssemblyResult({
            systemPrompt: 'sys',
            messages: input.messages,
            injectedFiles: input.injectedFiles,
            requestTools: input.promptTools,
            toolChoice: input.toolChoice,
          }),
      ),
      getToolRegistry: () =>
        ({
          tools: [],
          definitions: [],
          execute: vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => {
            if (name === 'return_value') {
              return {
                success: true,
                output: `Returned: ${args['content']}`,
                durationMs: 1,
                truncated: false,
              }
            }
            return { success: true, output: 'ok', durationMs: 1, truncated: false }
          }),
        }) as any,
      getConversationMessages: async () =>
        getConversationMessages(subAgentScope, {
          events: store.getEvents('session-1'),
        }) as unknown as RequestContextMessage[],
      ...overrides,
    }
  }

  function findMessageStarts(events: ReturnType<EventStore['getEvents']>, predicate: (content: string) => boolean) {
    return events.filter((e) => {
      if (e.type !== 'message.start') return false
      const data = e.data as { role?: string; content?: string }
      return data.role === 'user' && typeof data.content === 'string' && predicate(data.content)
    })
  }

  it('scopes the correction and continuation messages to the sub-agent, and the retry continues', async () => {
    const requestLog: LLMRequest[] = []
    const client = createSequencedClient(
      requestLog,
      [{ type: 'text_delta', content: '<tool_call' }],
      createReturnValueEvents(),
    )

    const config = makeConfig({
      subAgentMetadata: { subAgentId: 'sub-1', subAgentType: 'explorer', subAgentName: 'Explorer' },
      retryPatterns: [{ field: 'content', pattern: XML_PATTERN, action: 'retry', active: true }],
      maxRetriesPerTurn: 2,
      breakOnReturnValue: true,
      requireReturnValue: true,
      llmClient: client as never,
      llmRetryPolicy: FAST_POLICY,
    })
    const result = await runTopLevelAgentLoop(config, mockTurnMetrics)

    expect(result.failed).toBeUndefined()
    expect(result.returnValueContent).toBe('Done exploring')
    expect(result.returnValueResult).toBe('success')
    expect(requestLog).toHaveLength(2)

    const events = store.getEvents('session-1')
    const types = events.map((e) => e.type)

    // pattern.retry emitted for the partial sub-agent assistant message
    const patternRetry = events.find((e) => e.type === 'pattern.retry')
    expect(patternRetry).toBeDefined()
    const retryData = patternRetry!.data as {
      messageId: string
      pattern: string
      field: string
      attempt: number
      maxAttempts: number
      matchedContent: string
    }
    expect(retryData.pattern).toBe(XML_PATTERN)
    expect(retryData.field).toBe('content')
    expect(retryData.attempt).toBe(1)
    expect(retryData.maxAttempts).toBe(2)
    expect(retryData.matchedContent).toBe('<tool_call')

    // The matched assistant message is scoped to the sub-agent
    const partialAssistant = events.find(
      (e) => e.type === 'message.start' && (e.data as { messageId?: string }).messageId === retryData.messageId,
    )
    expect((partialAssistant!.data as { subAgentId?: string }).subAgentId).toBe('sub-1')

    // Correction message: "Pattern ... matched — auto-retry #1", scoped
    const corrections = findMessageStarts(events, (c) => c.startsWith('Pattern "'))
    expect(corrections).toHaveLength(1)
    const correction = corrections[0]!.data as { subAgentId?: string; subAgentType?: string; messageKind?: string }
    expect(correction.subAgentId).toBe('sub-1')
    expect(correction.subAgentType).toBe('explorer')
    expect(correction.messageKind).toBe('correction')
    expect((corrections[0]!.data as { content: string }).content).toContain('auto-retry #1')

    // Continuation prompt (fed to the second LLM round), scoped
    const continuations = findMessageStarts(events, (c) => c.includes('interrupted because it matched pattern'))
    expect(continuations).toHaveLength(1)
    const continuationData = continuations[0]!.data as {
      subAgentId?: string
      subAgentType?: string
      messageKind?: string
      content: string
    }
    expect(continuationData.subAgentId).toBe('sub-1')
    expect(continuationData.subAgentType).toBe('explorer')
    expect(continuationData.messageKind).toBe('correction')
    expect(continuationData.content).toContain(XML_PATTERN)

    // The sub-agent's second LLM round actually saw the correction + continuation
    const secondRoundMessages = requestLog[1]!.messages
    const userContents = secondRoundMessages.filter((m) => m.role === 'user').map((m) => m.content)
    expect(userContents.some((c) => c.includes('interrupted because it matched pattern'))).toBe(true)
    expect(userContents.some((c) => c.startsWith('Pattern "'))).toBe(true)

    // The parent's top-level context must NOT include the sub-agent's retry artifacts
    const topLevelMessages = buildContextMessagesFromStoredEvents(events)
    const topLevelContents = topLevelMessages.map((m) => m.content)
    expect(topLevelContents.some((c) => c.includes('interrupted because it matched pattern'))).toBe(false)
    expect(topLevelContents.some((c) => c.startsWith('Pattern "'))).toBe(false)
    expect(topLevelContents.some((c) => c === '<tool_call')).toBe(false)

    // The turn completes as a sub-agent turn
    const chatDone = events.filter((e) => e.type === 'chat.done')
    expect(chatDone).toHaveLength(1)
    const doneData = chatDone[0]!.data as { reason: string; agentType?: string }
    expect(doneData.reason).toBe('complete')
    expect(doneData.agentType).toBe('sub-agent')
    expect(types.includes('chat.error')).toBe(false)
  })

  it('enforces the retry cap in a sub-agent: chat.done(sub-agent) and throws, without a session-level chat.error', async () => {
    const requestLog: LLMRequest[] = []
    // Every attempt matches the pattern — the cap (1) is exceeded on the second
    const client = createSequencedClient(
      requestLog,
      [{ type: 'text_delta', content: '<tool_call' }],
      [{ type: 'text_delta', content: '<tool_call again' }],
    )

    const config = makeConfig({
      subAgentMetadata: { subAgentId: 'sub-1', subAgentType: 'explorer', subAgentName: 'Explorer' },
      retryPatterns: [{ field: 'content', pattern: XML_PATTERN, action: 'retry', active: true }],
      maxRetriesPerTurn: 1,
      llmClient: client as never,
      llmRetryPolicy: FAST_POLICY,
    })

    await expect(runTopLevelAgentLoop(config, mockTurnMetrics)).rejects.toThrow('Auto-retry limit exceeded')
    expect(requestLog).toHaveLength(2)

    const events = store.getEvents('session-1')
    // No session-level chat.error: a sub-agent must not raise the parent pane's error banner
    expect(events.find((e) => e.type === 'chat.error')).toBeUndefined()

    const chatDone = events.find((e) => e.type === 'chat.done')
    expect(chatDone).toBeDefined()
    const doneData = chatDone!.data as { reason: string; agentType?: string }
    expect(doneData.reason).toBe('error')
    expect(doneData.agentType).toBe('sub-agent')
  })

  it('emits a session-level chat.error when a top-level turn exceeds the retry cap', async () => {
    const requestLog: LLMRequest[] = []
    const client = createSequencedClient(
      requestLog,
      [{ type: 'text_delta', content: '<tool_call' }],
      [{ type: 'text_delta', content: '<tool_call again' }],
    )

    const config = makeConfig({
      retryPatterns: [{ field: 'content', pattern: XML_PATTERN, action: 'retry', active: true }],
      maxRetriesPerTurn: 1,
      llmClient: client as never,
      llmRetryPolicy: FAST_POLICY,
    })

    await expect(runTopLevelAgentLoop(config, mockTurnMetrics)).rejects.toThrow('Auto-retry limit exceeded')

    const events = store.getEvents('session-1')
    const chatError = events.find((e) => e.type === 'chat.error')
    expect(chatError).toBeDefined()
    expect((chatError!.data as { error: string }).error).toContain('Auto-retry limit exceeded')
    expect((chatError!.data as { recoverable?: boolean }).recoverable).toBe(false)
  })

  it('leaves top-level retry artifacts unscoped (no subAgentMetadata)', async () => {
    const requestLog: LLMRequest[] = []
    const cleanResponse: LLMCompletionResponse = {
      id: 'resp-clean',
      content: 'All done.',
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
    }
    const client = createSequencedClient(
      requestLog,
      [{ type: 'text_delta', content: '<tool_call' }],
      createReturnValueEvents(),
      [
        { type: 'text_delta', content: 'All done.' },
        { type: 'done', response: cleanResponse },
      ],
    )

    const config = makeConfig({
      retryPatterns: [{ field: 'content', pattern: XML_PATTERN, action: 'retry', active: true }],
      maxRetriesPerTurn: 2,
      llmClient: client as never,
      llmRetryPolicy: FAST_POLICY,
    })
    await runTopLevelAgentLoop(config, mockTurnMetrics)

    const events = store.getEvents('session-1')
    const corrections = findMessageStarts(events, (c) => c.startsWith('Pattern "'))
    expect(corrections).toHaveLength(1)
    const correctionData = corrections[0]!.data as { subAgentId?: string; subAgentType?: string }
    expect(correctionData.subAgentId).toBeUndefined()
    expect(correctionData.subAgentType).toBeUndefined()

    const continuations = findMessageStarts(events, (c) => c.includes('interrupted because it matched pattern'))
    expect(continuations).toHaveLength(1)
    const continuationData = continuations[0]!.data as { subAgentId?: string }
    expect(continuationData.subAgentId).toBeUndefined()
  })
})
