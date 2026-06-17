import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionManager } from '../session/index.js'
import type { TurnMetrics } from './stream-pure.js'
import type { TopLevelLoopConfig } from './agent-loop.js'
import type { ToolCall } from '../../shared/types.js'

vi.mock('./stream-pure.js', () => ({
  streamLLMPure: vi.fn(),
  consumeStreamGenerator: vi.fn(),
  TurnMetrics: vi.fn(),
  createMessageStartEvent: vi.fn((messageId: string, role: string, content?: string, options?: any) => ({
    type: 'message.start',
    data: { messageId, role, content, ...options },
  })),
  createMessageDoneEvent: vi.fn((messageId: string, options?: any) => ({
    type: 'message.done',
    data: { messageId, ...options },
  })),
  createChatDoneEvent: vi.fn((messageId: string, reason: string) => ({
    type: 'chat.done',
    data: { messageId, reason },
  })),
  createFormatRetryEvent: vi.fn((attempt: number, maxAttempts: number) => ({
    type: 'format.retry',
    data: { attempt, maxAttempts },
  })),
}))

vi.mock('./execute-tools.js', () => ({
  executeTools: vi.fn(),
}))

vi.mock('./auto-patterns.js', () => ({
  matchAutoPatterns: vi.fn().mockReturnValue([]),
}))

vi.mock('../context/auto-compaction.js', () => ({
  maybeAutoCompactContext: vi.fn(),
}))

vi.mock('../context/compactor.js', () => ({
  shouldCompact: vi.fn().mockReturnValue(false),
}))

vi.mock('./conversation-history.js', () => ({
  getConversationMessages: vi.fn().mockReturnValue([]),
}))

vi.mock('../db/settings.js', () => ({
  getSetting: vi.fn(),
  SETTINGS_KEYS: { LLM_DYNAMIC_SYSTEM_PROMPT: 'llm.dynamicSystemPrompt' },
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: vi.fn().mockResolvedValue({ content: '', files: [] }),
}))

vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn().mockResolvedValue([]),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi
    .fn()
    .mockReturnValue({ mode: 'test', workdir: '/test', agent: {}, context: { compactionThreshold: 0.8 } }),
}))

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn().mockReturnValue('/test/config'),
}))

vi.mock('../events/index.js', () => ({
  getCurrentContextWindowId: vi.fn().mockReturnValue(undefined),
  getEventStore: vi.fn().mockReturnValue({ append: vi.fn(), getEvents: vi.fn().mockReturnValue([]) }),
}))

import { runTopLevelAgentLoop } from './agent-loop.js'
import { consumeStreamGenerator } from './stream-pure.js'
import { executeTools } from './execute-tools.js'
import { matchAutoPatterns } from './auto-patterns.js'

function createMockSessionManager(overrides?: Record<string, any>): SessionManager {
  return {
    requireSession: vi.fn().mockReturnValue({
      workdir: '/test',
      projectId: 'test-project',
      executionState: null,
      criteria: [],
      isRunning: false,
    }),
    getContextState: vi.fn().mockReturnValue({
      currentTokens: 0,
      maxTokens: 200000,
      compactionCount: 0,
      dangerZone: false,
      canCompact: false,
      dynamicContextChanged: false,
    }),
    getCurrentModelSettings: vi.fn().mockReturnValue({}),
    getCurrentModelContext: vi.fn().mockReturnValue(200000),
    setCurrentContextSize: vi.fn(),
    getDynamicContextChanged: vi.fn().mockReturnValue(false),
    setDynamicContextChanged: vi.fn(),
    getCachedPrompt: vi.fn().mockReturnValue(undefined),
    setCachedPrompt: vi.fn(),
    getLspManager: vi.fn(),
    drainAsapMessages: vi.fn().mockReturnValue([]),
    getCurrentWindowMessages: vi.fn().mockReturnValue([]),
    updateMessage: vi.fn(),
    getQueueState: vi.fn().mockReturnValue({ queued: 0, processing: false }),
    addModifiedFile: vi.fn(),
    ...overrides,
  } as any
}

function makeConfig(overrides?: Partial<TopLevelLoopConfig>): TopLevelLoopConfig {
  return {
    mode: 'planner',
    append: vi.fn(),
    sessionManager: createMockSessionManager(),
    sessionId: 'test-session',
    llmClient: { getModel: vi.fn().mockReturnValue('test-model') } as any,
    statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'test-model' },
    assembleRequest: vi.fn().mockReturnValue({
      systemPrompt: 'test-prompt',
      messages: [],
      promptContext: {
        systemPrompt: 'test-prompt',
        injectedFiles: [],
        userMessage: '',
        messages: [],
        tools: [],
        requestOptions: { toolChoice: 'auto', disableThinking: false },
      },
    }),
    getToolRegistry: () => ({ definitions: [], execute: vi.fn() }) as any,
    ...overrides,
  }
}

function makeStreamResult(overrides?: Record<string, any>) {
  return {
    content: '',
    thinkingContent: undefined,
    toolCalls: [],
    segments: [],
    usage: { promptTokens: 100, completionTokens: 50 },
    timing: {} as any,
    aborted: false,
    xmlFormatError: false,
    modelParams: {},
    finishReason: 'stop' as const,
    ...overrides,
  }
}

describe('agentLoop integration', () => {
  let turnMetrics: TurnMetrics

  beforeEach(() => {
    vi.clearAllMocks()
    turnMetrics = {
      addToolTime: vi.fn(),
      addLLMCall: vi.fn(),
      buildStats: vi.fn().mockReturnValue({}),
    } as any
    ;(consumeStreamGenerator as any).mockResolvedValue(makeStreamResult())
  })

  it('continues loop when tool calls are returned and executeTools produces messages', async () => {
    const append = vi.fn()
    const toolCall: ToolCall = { id: 'call-1', name: 'run_command', arguments: { command: 'echo hi' } }

    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(makeStreamResult({ toolCalls: [toolCall], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(makeStreamResult({ content: 'Done', finishReason: 'stop' }))
    ;(executeTools as any).mockResolvedValue({
      toolMessages: [{ role: 'tool', content: 'output', source: 'history', toolCallId: 'call-1' }],
    })

    await runTopLevelAgentLoop(makeConfig({ append }), turnMetrics)

    // Should have called streamLLM twice (first for tool calls, second for final response)
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(2)
    // Should emit chat.done at the end
    const chatDoneEvents = append.mock.calls.filter((args: unknown[]) => (args[0] as any).type === 'chat.done')
    expect(chatDoneEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('breaks loop when no tool calls and no queued messages', async () => {
    const append = vi.fn()

    ;(consumeStreamGenerator as any).mockResolvedValue(
      makeStreamResult({ content: 'Final answer', finishReason: 'stop' }),
    )
    // drainAsapMessages returns empty by default via createMockSessionManager

    await runTopLevelAgentLoop(makeConfig({ append }), turnMetrics)

    // Should have called streamLLM once
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(1)
    // Should emit chat.done
    const chatDoneEvents = append.mock.calls.filter((args: unknown[]) => (args[0] as any).type === 'chat.done')
    expect(chatDoneEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects tool calls in compaction mode and continues loop', async () => {
    const append = vi.fn()
    const toolCall: ToolCall = { id: 'call-1', name: 'run_command', arguments: { command: 'echo hi' } }

    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(makeStreamResult({ toolCalls: [toolCall], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(makeStreamResult({ content: 'Summary', finishReason: 'stop' }))

    await runTopLevelAgentLoop(makeConfig({ append, loopMode: 'compaction' }), turnMetrics)

    // Should have called streamLLM twice
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(2)
    // Should NOT have called executeTools
    expect(executeTools).not.toHaveBeenCalled()
    // Should have appended a rejection message
    const startEvents = append.mock.calls.filter(
      (args: unknown[]) =>
        (args[0] as any).type === 'message.start' && (args[0] as any).data?.content?.includes('Compaction in progress'),
    )
    expect(startEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('continues loop when auto-patterns match', async () => {
    const append = vi.fn()

    ;(matchAutoPatterns as any).mockReturnValueOnce([{ response: 'Auto response' }]).mockReturnValueOnce([])
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(makeStreamResult({ content: 'bad format', finishReason: 'stop' }))
      .mockResolvedValueOnce(makeStreamResult({ content: 'good format', finishReason: 'stop' }))

    await runTopLevelAgentLoop(makeConfig({ append }), turnMetrics)

    // Should have called streamLLM twice
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(2)
    // Should have appended auto-response message
    const startEvents = append.mock.calls.filter(
      (args: unknown[]) =>
        (args[0] as any).type === 'message.start' && (args[0] as any).data?.content === 'Auto response',
    )
    expect(startEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('retries on truncation (finishReason=length) up to MAX_TRUNCATION_RETRIES', async () => {
    const append = vi.fn()

    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(
        makeStreamResult({ finishReason: 'length', toolCalls: [], usage: { promptTokens: 100, completionTokens: 50 } }),
      )
      .mockResolvedValueOnce(
        makeStreamResult({ finishReason: 'length', toolCalls: [], usage: { promptTokens: 100, completionTokens: 50 } }),
      )
      .mockResolvedValueOnce(
        makeStreamResult({ finishReason: 'length', toolCalls: [], usage: { promptTokens: 100, completionTokens: 50 } }),
      )
      .mockResolvedValueOnce(
        makeStreamResult({ content: 'Done', finishReason: 'stop', usage: { promptTokens: 100, completionTokens: 50 } }),
      )

    await runTopLevelAgentLoop(makeConfig({ append }), turnMetrics)

    // Should have called streamLLM 4 times (3 retries + 1 success)
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(4)
    // Should emit chat.done
    const chatDoneEvents = append.mock.calls.filter((args: unknown[]) => (args[0] as any).type === 'chat.done')
    expect(chatDoneEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('exhausts truncation retries and emits truncated', async () => {
    const append = vi.fn()

    ;(consumeStreamGenerator as any).mockResolvedValue(
      makeStreamResult({ finishReason: 'length', toolCalls: [], usage: { promptTokens: 100, completionTokens: 50 } }),
    )

    await runTopLevelAgentLoop(makeConfig({ append }), turnMetrics)

    // Should have called streamLLM 4 times (MAX_TRUNCATION_RETRIES retries + 1 final break)
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(4)
    // Should emit chat.done with 'truncated' reason
    const truncatedEvents = append.mock.calls.filter(
      (args: unknown[]) => (args[0] as any).type === 'chat.done' && (args[0] as any).data?.reason === 'truncated',
    )
    expect(truncatedEvents.length).toBeGreaterThanOrEqual(1)
  })
})
