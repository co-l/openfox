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
}))

vi.mock('./execute-tools.js', () => ({
  executeTools: vi.fn(),
}))

vi.mock('../context/compactor.js', () => ({
  shouldCompact: vi.fn().mockReturnValue(false),
  appendCompactionPrompt: vi.fn((_sessionId: string, append: (event: any) => void) => {
    append({
      type: 'message.start',
      data: {
        messageId: 'compact-prompt',
        role: 'user',
        content: 'You are a helpful AI assistant tasked with summarizing conversations for continuation.',
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
        metadata: { type: 'compaction', name: 'Compaction', color: '#64748b' },
      },
    })
    append({ type: 'message.done', data: { messageId: 'compact-prompt' } })
  }),
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
  getRuntimeConfig: vi.fn().mockReturnValue({
    mode: 'test',
    workdir: '/test',
    agent: {},
    context: { compactionThreshold: 0.8 },
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

vi.mock('../events/index.js', () => ({
  getCurrentContextWindowId: vi.fn().mockReturnValue(undefined),
  getCurrentWindowMessageOptions: vi.fn().mockReturnValue(undefined),
  getEventStore: vi.fn().mockReturnValue({ append: vi.fn(), getEvents: vi.fn().mockReturnValue([]) }),
}))

import { runTopLevelAgentLoop } from './agent-loop.js'
import { consumeStreamGenerator } from './stream-pure.js'
import { executeTools } from './execute-tools.js'

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
    }),
    getToolRegistry: () => ({ definitions: [], execute: vi.fn() }) as any,
    getConversationMessages: vi.fn().mockResolvedValue([]),
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

  it('continues loop when retry pattern matches', async () => {
    const append = vi.fn()

    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(
        makeStreamResult({
          content: 'bad format',
          finishReason: 'stop',
          patternMatch: { pattern: 'bad', field: 'content', matchedContent: 'bad format' },
        }),
      )
      .mockResolvedValueOnce(makeStreamResult({ content: 'good format', finishReason: 'stop' }))

    await runTopLevelAgentLoop(makeConfig({ append }), turnMetrics)

    // Should have called streamLLM twice
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(2)
    // Should have appended pattern.retry event
    const retryEvents = append.mock.calls.filter((args: unknown[]) => (args[0] as any).type === 'pattern.retry')
    expect(retryEvents.length).toBeGreaterThanOrEqual(1)
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

  it('breaks loop immediately when step_done is called', async () => {
    const append = vi.fn()
    const toolCall: ToolCall = { id: 'call-1', name: 'step_done', arguments: {} }

    ;(consumeStreamGenerator as any).mockResolvedValueOnce(
      makeStreamResult({ toolCalls: [toolCall], finishReason: 'tool_calls' }),
    )
    ;(executeTools as any).mockResolvedValue({
      toolMessages: [
        { role: 'tool', content: 'Step completion signal recorded.', source: 'history', toolCallId: 'call-1' },
      ],
      stepDoneCalled: true,
    })

    await runTopLevelAgentLoop(makeConfig({ append }), turnMetrics)

    // Should have called streamLLM only once (no second LLM call after step_done)
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(1)
    // Should emit chat.done
    const chatDoneEvents = append.mock.calls.filter((args: unknown[]) => (args[0] as any).type === 'chat.done')
    expect(chatDoneEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('continues loop when step_done is not called', async () => {
    const append = vi.fn()
    const toolCall: ToolCall = { id: 'call-1', name: 'run_command', arguments: { command: 'echo hi' } }

    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(makeStreamResult({ toolCalls: [toolCall], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(makeStreamResult({ content: 'Done', finishReason: 'stop' }))
    ;(executeTools as any).mockResolvedValue({
      toolMessages: [{ role: 'tool', content: 'output', source: 'history', toolCallId: 'call-1' }],
      stepDoneCalled: false,
    })

    await runTopLevelAgentLoop(makeConfig({ append }), turnMetrics)

    // Should have called streamLLM twice (tool calls then final response)
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(2)
    // Should emit chat.done at the end
    const chatDoneEvents = append.mock.calls.filter((args: unknown[]) => (args[0] as any).type === 'chat.done')
    expect(chatDoneEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('auto-compacts within the loop when threshold is exceeded, then continues normally', async () => {
    const append = vi.fn()
    const injectAgentReminder = vi.fn()

    // First call: normal response. Second call: compaction summary. Third call: normal response after compaction.
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(makeStreamResult({ content: 'Normal response', finishReason: 'stop' }))
      .mockResolvedValueOnce(makeStreamResult({ content: 'Compacted summary', finishReason: 'stop' }))
      .mockResolvedValueOnce(makeStreamResult({ content: 'Final response after compaction', finishReason: 'stop' }))

    // Trigger compaction after first LLM call, then return false thereafter
    const { shouldCompact } = await import('../context/compactor.js')
    ;(shouldCompact as any).mockReturnValueOnce(true)

    await runTopLevelAgentLoop(
      makeConfig({ append, injectAgentReminder, getConversationMessages: vi.fn().mockResolvedValue([]) }),
      turnMetrics,
    )

    // Should have called streamLLM 3 times (normal → compaction → normal)
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(3)

    // Should have emitted context.compacted
    const compactedEvents = append.mock.calls
      .map((args: unknown[]) => args[0] as any)
      .filter((e: any) => e.type === 'context.compacted')
    expect(compactedEvents.length).toBe(1)

    // Should have called injectAgentReminder after compaction
    expect(injectAgentReminder).toHaveBeenCalledTimes(1)

    // Should have appended the compaction prompt
    const promptEvents = append.mock.calls
      .map((args: unknown[]) => args[0] as any)
      .filter(
        (e: any) =>
          e.type === 'message.start' &&
          e.data?.messageKind === 'auto-prompt' &&
          e.data?.content?.includes('summarizing conversations'),
      )
    expect(promptEvents.length).toBe(1)

    // Should emit chat.done at the end (normal completion)
    const chatDoneEvents = append.mock.calls
      .map((args: unknown[]) => args[0] as any)
      .filter((e: any) => e.type === 'chat.done' && e.data?.reason === 'complete')
    expect(chatDoneEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('sends tool-call assistant content as empty string to the next LLM call after a failed tool', async () => {
    const append = vi.fn()
    const toolCall: ToolCall = {
      id: 'call-1',
      name: 'run_command',
      arguments: { command: 'echo hi' },
    }

    // Stateful conversation: first iteration returns only the user prompt,
    // second iteration includes the assistant tool-call msg + tool result
    const getConversationMessagesMock = vi.fn()
      .mockResolvedValueOnce([{ role: 'user' as const, content: 'Run a command', source: 'history' as const }])
      .mockResolvedValueOnce([
        { role: 'user' as const, content: 'Run a command', source: 'history' as const },
        {
          role: 'assistant' as const,
          content: '',
          toolCalls: [toolCall],
          source: 'history' as const,
        },
        { role: 'tool' as const, content: 'Command failed: exit code 1', source: 'history' as const, toolCallId: 'call-1' },
      ])

    const assembleRequestMock = vi.fn().mockReturnValue({
      systemPrompt: 'test-prompt',
      messages: [],
      tools: [],
    })

    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(makeStreamResult({ toolCalls: [toolCall], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(makeStreamResult({ content: 'Done', finishReason: 'stop' }))
    ;(executeTools as any).mockResolvedValue({
      toolMessages: [
        { role: 'tool', content: 'Command failed: exit code 1', source: 'history', toolCallId: 'call-1' },
      ],
      stepDoneCalled: false,
    })

    await runTopLevelAgentLoop(
      makeConfig({
        append,
        assembleRequest: assembleRequestMock,
        getConversationMessages: getConversationMessagesMock,
      }),
      turnMetrics,
    )

    // Should have called streamLLM 2 times (failed tool → then final without tools)
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(2)
    // executeTools called once (second LLM call returned no tools)
    expect(executeTools).toHaveBeenCalledTimes(1)

    // assembleRequest was called for each LLM iteration
    expect(assembleRequestMock).toHaveBeenCalledTimes(2)

    // Verify the second LLM call receives the assistant message with content: ''
    const secondCallArgs = assembleRequestMock.mock.calls[1]![0] as { messages: any[] }
    const assistantMsg = secondCallArgs.messages.find(
      (m: any) => m.role === 'assistant' && m.toolCalls?.length > 0,
    )
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg.content).toBe('')
    expect(assistantMsg.toolCalls[0].name).toBe('run_command')
    expect(assistantMsg.toolCalls[0].id).toBe('call-1')

    // Tool result follows the assistant message
    const toolMsg = secondCallArgs.messages.find((m: any) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    expect(toolMsg.content).toContain('failed')
    expect(toolMsg.toolCallId).toBe('call-1')

    // Should emit chat.done at the end (normal completion)
    const chatDoneEvents = append.mock.calls
      .map((args: unknown[]) => args[0] as any)
      .filter((e: any) => e.type === 'chat.done' && e.data?.reason === 'complete')
    expect(chatDoneEvents.length).toBeGreaterThanOrEqual(1)
  })
})
