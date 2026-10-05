/**
 * Sub-Agent Manager – Auto-Retry Patterns (real EventStore)
 *
 * executeSubAgent must apply the user-configured auto-retry patterns, exactly
 * like a top-level turn: a streamed sub-agent response matching an active
 * pattern is aborted mid-stream, a pattern.retry + scoped correction message
 * are persisted, the sub-agent continues with the continuation prompt, and
 * the parent's top-level context is never polluted by the retry artifacts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import type { LLMStreamEvent, LLMCompletionResponse } from '../llm/types.js'
import { initEventStore, type EventStore } from '../events/store.js'
import { buildContextMessagesFromStoredEvents } from '../events/folding.js'
import type { SessionManager } from '../session/index.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ProviderManager } from '../provider-manager.js'
import type { ToolRegistry } from '../tools/types.js'
import type { TurnMetrics } from '../chat/stream-pure.js'
import { getConversationMessages, type SubAgentScope } from '../chat/conversation-history.js'
import { executeSubAgent } from './manager.js'

const { getEventStoreMock, getAllInstructionsMock, getSettingMock } = vi.hoisted(() => ({
  getEventStoreMock: vi.fn(),
  getAllInstructionsMock: vi.fn(),
  getSettingMock: vi.fn(),
}))

vi.mock('../events/index.js', () => ({
  getEventStore: getEventStoreMock,
  getCurrentContextWindowId: vi.fn(() => undefined),
  getCurrentWindowMessageOptions: vi.fn(() => undefined),
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: getAllInstructionsMock,
  toInjectedFiles: (files: unknown[]) => files as unknown,
}))

vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(async () => []),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn(() => ({
    mode: 'development',
    context: { compactionThreshold: 0.9 },
    agent: { toolTimeout: 120000 },
  })),
}))

vi.mock('../context/compactor.js', () => ({
  shouldCompact: vi.fn(() => false),
  appendCompactionPrompt: vi.fn(),
}))

vi.mock('../agents/model-overrides.js', () => ({
  resolveLLMClientForAgent: vi.fn((_: string, client: LLMClientWithModel) => ({ client, usedOverride: false })),
  buildAgentOverrideStatsIdentity: vi.fn(),
  AGENT_MODEL_OVERRIDES_KEY: 'agent.modelOverrides',
}))

vi.mock('../db/settings.js', () => ({
  getSetting: getSettingMock,
  setSetting: vi.fn(),
  SETTINGS_KEYS: {
    RETRY_PATTERNS: 'agent.retryPatterns',
    AGENT_ALLOW_PARALLEL_SUB_AGENTS: 'agent.allowParallelSubAgents',
  },
}))

function createMockSessionManager(): SessionManager {
  return {
    requireSession: vi.fn().mockReturnValue({
      criteria: [],
      workdir: '/test',
      projectId: 'test-project',
    }),
    setCurrentContextSize: vi.fn(),
    getContextState: vi.fn().mockReturnValue({
      currentTokens: 1000,
      maxTokens: 128000,
      compactionCount: 0,
      dangerZone: false,
      canCompact: false,
      dynamicContextChanged: false,
    }),
    getCurrentModelSettings: vi.fn().mockReturnValue({}),
    getCurrentModelContext: vi.fn().mockReturnValue(128000),
    getModelCompactionThreshold: vi.fn().mockReturnValue(undefined),
    getSubAgentContextTokens: vi.fn().mockReturnValue(0),
    getLspManager: vi.fn().mockReturnValue(undefined),
    getEffectiveWorkdir: vi.fn().mockReturnValue('/test'),
    getProjectWorkdir: vi.fn().mockReturnValue('/test'),
    drainAsapMessages: vi.fn().mockReturnValue([]),
    resolveEffectiveProviderModel: vi.fn(() => ({ providerId: null, model: null })),
    enterPauseGate: vi.fn().mockResolvedValue('released'),
    setActiveSubAgent: vi.fn(),
  } as unknown as SessionManager
}

function createMockToolRegistry(): ToolRegistry {
  return {
    tools: [],
    definitions: [
      {
        type: 'function',
        function: {
          name: 'return_value',
          description: 'Return value',
          parameters: { type: 'object', properties: { content: { type: 'string' }, result: { type: 'string' } } },
        },
      },
    ],
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
  } as unknown as ToolRegistry
}

function createMockTurnMetrics(): TurnMetrics {
  return {
    addLLMCall: vi.fn(),
    addToolTime: vi.fn(),
    buildStats: vi.fn().mockReturnValue({ totalDurationMs: 100, llmCalls: 1 }),
  } as unknown as TurnMetrics
}

const TEST_STATS_IDENTITY = { providerId: 'mock', providerName: 'mock', backend: 'ollama' as const, model: 'test' }

interface LLMRequest {
  messages: Array<{ role: string; content: string }>
}

function createSequencedClient(requestLog: LLMRequest[], ...eventSets: LLMStreamEvent[][]): LLMClientWithModel {
  let attempt = 0
  return {
    getModel: () => 'test-model',
    setModel: () => {},
    getProfile: () => ({ contextWindow: 128000, supportsVision: false, supportsThinking: false }),
    getBackend: () => 'ollama' as const,
    setBackend: () => {},
    stream: async function* (request: LLMRequest) {
      requestLog.push(request)
      const events = eventSets[Math.min(attempt, eventSets.length - 1)]!
      attempt += 1
      for (const event of events) {
        yield event
      }
    },
  } as unknown as LLMClientWithModel
}

describe('executeSubAgent auto-retry patterns', () => {
  let db: Database.Database
  let eventStore: EventStore

  beforeEach(() => {
    vi.clearAllMocks()
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workdir TEXT NOT NULL
      )
    `)
    eventStore = initEventStore(db)
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
    getSettingMock.mockImplementation((key: string) =>
      key === 'agent.retryPatterns'
        ? JSON.stringify({
            patterns: [{ field: 'content', pattern: 'bad_word', action: 'retry', active: true }],
            maxRetriesPerTurn: 3,
          })
        : null,
    )
  })

  afterEach(() => {
    db.close()
  })

  it('aborts a matching sub-agent response, retries with the continuation, and scopes all artifacts to the sub-agent', async () => {
    const requestLog: LLMRequest[] = []
    const response: LLMCompletionResponse = {
      id: 'mock-2',
      content: 'Completed.',
      toolCalls: [{ id: 'call-1', name: 'return_value', arguments: { content: 'Final result', result: 'success' } }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
    }
    const llmClient = createSequencedClient(
      requestLog,
      [{ type: 'text_delta', content: 'I found bad_word in src/foo.ts' }],
      [
        {
          type: 'tool_call_delta',
          index: 0,
          id: 'call-1',
          name: 'return_value',
          arguments: '{"content":"Final result","result":"success"}',
        },
        { type: 'text_delta', content: 'Completed.' },
        { type: 'done', response },
      ],
    )

    const result = await executeSubAgent({
      subAgentType: 'explorer',
      prompt: 'Find the file.',
      sessionManager: createMockSessionManager(),
      sessionId: 'test-session',
      llmClient,
      toolRegistry: createMockToolRegistry(),
      turnMetrics: createMockTurnMetrics(),
      statsIdentity: TEST_STATS_IDENTITY,
      providerManager: undefined as unknown as ProviderManager,
    })

    expect(result.content).toBe('Final result')
    expect(result.result).toBe('success')
    expect(requestLog).toHaveLength(2)

    const events = eventStore.getEvents('test-session')

    // The mid-stream match was recorded
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
    expect(retryData.pattern).toBe('bad_word')
    expect(retryData.field).toBe('content')
    expect(retryData.attempt).toBe(1)
    expect(retryData.maxAttempts).toBe(3)
    expect(retryData.matchedContent).toBe('I found bad_word in src/foo.ts')

    const subAgentMessages = events.filter(
      (e) => e.type === 'message.start' && (e.data as { subAgentId?: string }).subAgentId !== undefined,
    )
    expect(subAgentMessages.length).toBeGreaterThan(0)
    const allTagged = (e: (typeof events)[number]) =>
      e.type === 'message.start' && (e.data as { subAgentId?: string }).subAgentId !== undefined
    expect(subAgentMessages.every((e) => allTagged(e))).toBe(true)

    // The correction + continuation are scoped to the sub-agent
    const starts = events.filter((e) => e.type === 'message.start')
    const correction = starts.find((e) => (e.data as { content?: string }).content?.startsWith('Pattern "'))
    expect(correction).toBeDefined()
    const correctionData = correction!.data as { subAgentId?: string; subAgentType?: string; messageKind?: string }
    expect(correctionData.subAgentId).toBeDefined()
    expect(correctionData.subAgentType).toBe('explorer')
    expect(correctionData.messageKind).toBe('correction')

    const continuation = starts.find((e) =>
      (e.data as { content?: string }).content?.includes('interrupted because it matched pattern'),
    )
    expect(continuation).toBeDefined()
    const continuationData = continuation!.data as { subAgentId?: string; messageKind?: string; content: string }
    expect(continuationData.subAgentId).toBeDefined()
    expect(continuationData.messageKind).toBe('correction')
    expect(continuationData.content).toContain('bad_word')

    // The sub-agent's second LLM round saw the retry artifacts (via its scoped context)
    const subAgentId = correctionData.subAgentId!
    const secondRoundMessages = requestLog[1]!.messages
    expect(secondRoundMessages.some((m) => m.content.includes('interrupted because it matched pattern'))).toBe(true)
    expect(secondRoundMessages.some((m) => m.content.startsWith('Pattern "'))).toBe(true)

    // The parent's top-level context must not contain any sub-agent retry artifacts
    const topLevelMessages = buildContextMessagesFromStoredEvents(events)
    const topLevelContents = topLevelMessages.map((m) => m.content)
    expect(topLevelContents.some((c) => c.includes('bad_word'))).toBe(false)
    expect(topLevelContents.some((c) => c.includes('interrupted because it matched pattern'))).toBe(false)
    expect(topLevelContents.some((c) => c.startsWith('Pattern "'))).toBe(false)

    // The sub-agent's scoped context does include them
    const scope: SubAgentScope = { type: 'subagent', sessionId: 'test-session', subAgentId, subAgentType: 'explorer' }
    const scopedMessages = getConversationMessages(scope, { events })
    const scopedContents = scopedMessages.map((m) => m.content ?? '')
    expect(scopedContents.some((c) => c.includes('interrupted because it matched pattern'))).toBe(true)
    expect(scopedContents.some((c) => c.startsWith('Pattern "'))).toBe(true)

    // The turn completed as a sub-agent turn
    const chatDone = events.find((e) => e.type === 'chat.done')
    expect(chatDone).toBeDefined()
    const doneData = chatDone!.data as { reason: string; agentType?: string }
    expect(doneData.reason).toBe('complete')
    expect(doneData.agentType).toBe('sub-agent')
    expect(events.some((e) => e.type === 'chat.error')).toBe(false)
  })

  it('runs the sub-agent to completion when no pattern matches', async () => {
    const requestLog: LLMRequest[] = []
    const response: LLMCompletionResponse = {
      id: 'mock-3',
      content: 'Completed.',
      toolCalls: [{ id: 'call-1', name: 'return_value', arguments: { content: 'All good', result: 'success' } }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
    }
    const llmClient = createSequencedClient(requestLog, [
      {
        type: 'tool_call_delta',
        index: 0,
        id: 'call-1',
        name: 'return_value',
        arguments: '{"content":"All good","result":"success"}',
      },
      { type: 'text_delta', content: 'Completed.' },
      { type: 'done', response },
    ])

    const result = await executeSubAgent({
      subAgentType: 'explorer',
      prompt: 'Find the file.',
      sessionManager: createMockSessionManager(),
      sessionId: 'test-session',
      llmClient,
      toolRegistry: createMockToolRegistry(),
      turnMetrics: createMockTurnMetrics(),
      statsIdentity: TEST_STATS_IDENTITY,
      providerManager: undefined as unknown as ProviderManager,
    })

    expect(result.content).toBe('All good')
    expect(result.result).toBe('success')
    expect(requestLog).toHaveLength(1)

    const events = eventStore.getEvents('test-session')
    expect(events.some((e) => e.type === 'pattern.retry')).toBe(false)
    const starts = events.filter((e) => e.type === 'message.start')
    expect(
      starts.some((e) => (e.data as { content?: string }).content?.includes('interrupted because it matched pattern')),
    ).toBe(false)
  })
})
