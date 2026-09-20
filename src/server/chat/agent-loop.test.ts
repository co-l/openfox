import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolResult, ToolCall } from '../../shared/types.js'
import type { SessionManager } from '../session/index.js'
import type { ToolRegistry } from '../tools/types.js'
import type { TurnMetrics } from './stream-pure.js'
import type { EventStore } from '../events/store.js'
import type { TopLevelLoopConfig } from './agent-loop.js'

// Mock the event store module
vi.mock('../events/store.js', () => ({
  getEventStore: vi.fn(),
}))

// Mock instructions
vi.mock('../context/instructions.js', () => ({
  getAllInstructions: vi.fn(),
}))

// Mock skills
vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(),
}))

// Mock runtime config
vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn().mockReturnValue({
    mode: 'test',
    workdir: '/test',
    agent: { toolTimeout: 60000 },
    context: { compactionThreshold: 0.85 },
    llm: {
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      timeout: 30000,
      idleTimeout: 30000,
      backend: 'ollama',
    },
  }),
}))

// Mock paths
vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn().mockReturnValue('/test/config'),
}))

// Mock conversation history
vi.mock('./conversation-history.js', () => ({
  getConversationMessages: vi.fn().mockReturnValue([]),
}))

// Mock stream-pure to capture modelSettings for clamping tests
import { streamLLMPure, consumeStreamGenerator } from './stream-pure.js'

vi.mock('./stream-pure.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./stream-pure.js')>()
  return {
    ...actual,
    streamLLMPure: vi.fn(),
    consumeStreamGenerator: vi.fn(),
  }
})

import { runTopLevelAgentLoop } from './agent-loop.js'
import { executeTools } from './execute-tools.js'
import { getEventStore } from '../events/store.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'

describe('executeTools', () => {
  let mockSessionManager: SessionManager
  let mockToolRegistry: ToolRegistry
  let mockOnMessage: (msg: unknown) => void
  let mockEventStore: EventStore

  beforeEach(() => {
    mockOnMessage = vi.fn()
    mockEventStore = {
      append: vi.fn(),
      getEvents: vi.fn().mockReturnValue([]),
    } as unknown as EventStore

    // Mock the event store singleton
    ;(getEventStore as any).mockReturnValue(mockEventStore)

    mockSessionManager = {
      enterPauseGate: vi.fn().mockResolvedValue('released'),
      requireSession: vi.fn().mockReturnValue({
        criteria: [],
        workdir: '/test',
        projectId: 'test-project',
      }),
      getLspManager: vi.fn(),
      getEffectiveWorkdir: vi.fn().mockReturnValue('/test'),
      getProjectWorkdir: vi.fn().mockReturnValue('/test'),
      drainAsapMessages: vi.fn().mockReturnValue([]),
    } as unknown as SessionManager

    mockToolRegistry = {
      tools: [],
      execute: vi.fn(),
      definitions: [],
    } as unknown as ToolRegistry
  })

  it('includes output in tool message when command fails (success: false)', async () => {
    const mockToolResult: ToolResult = {
      success: false,
      output: 'TypeScript error output\nLine 1: error TS123',
      error: 'Command exited with code 2',
      durationMs: 100,
      truncated: false,
    }

    mockToolRegistry.execute = vi.fn().mockResolvedValue(mockToolResult)

    const toolCalls: ToolCall[] = [
      {
        id: 'test-call-1',
        name: 'run_command',
        arguments: { command: 'npm run typecheck' },
      },
    ]

    const result = await executeTools(
      'assistant-msg-1',
      toolCalls,
      {
        toolRegistry: mockToolRegistry,
        sessionManager: mockSessionManager,
        sessionId: 'test-session',
        workdir: '/test',
        turnMetrics: {
          addToolTime: vi.fn(),
          addLLMCall: vi.fn(),
          buildStats: vi.fn(),
        } as unknown as TurnMetrics,
        signal: undefined,
        onMessage: mockOnMessage,
      },
      vi.fn(),
    )

    // The tool message should include both the output and the error
    expect(result.toolMessages).toHaveLength(1)
    expect(result.toolMessages[0]?.content).toContain('TypeScript error output')
    expect(result.toolMessages[0]?.content).toContain('Line 1: error TS123')
    expect(result.toolMessages[0]?.content).toContain('Error: Command exited with code 2')
    // Output should come before the error
    const outputIndex = result.toolMessages[0]?.content.indexOf('TypeScript error output') ?? -1
    const errorIndex = result.toolMessages[0]?.content.indexOf('Error: Command exited with code 2') ?? -1
    expect(outputIndex).toBeLessThan(errorIndex)
  })

  it('shows only error when tool fails without output', async () => {
    const mockToolResult: ToolResult = {
      success: false,
      error: 'Criterion not found: missing',
      durationMs: 0,
      truncated: false,
    }

    mockToolRegistry.execute = vi.fn().mockResolvedValue(mockToolResult)

    const toolCalls: ToolCall[] = [
      {
        id: 'test-call-2',
        name: 'update_criterion',
        arguments: { id: 'missing' },
      },
    ]

    const result = await executeTools(
      'assistant-msg-2',
      toolCalls,
      {
        toolRegistry: mockToolRegistry,
        sessionManager: mockSessionManager,
        sessionId: 'test-session',
        workdir: '/test',
        turnMetrics: {
          addToolTime: vi.fn(),
          addLLMCall: vi.fn(),
          buildStats: vi.fn(),
        } as unknown as TurnMetrics,
        signal: undefined,
        onMessage: mockOnMessage,
      },
      vi.fn(),
    )

    // Should only show the error, no empty output section
    expect(result.toolMessages).toHaveLength(1)
    expect(result.toolMessages[0]?.content).toBe('Error: Criterion not found: missing')
    expect(result.toolMessages[0]?.content).not.toContain('\n\nError:')
  })

  it('shows output when tool succeeds', async () => {
    const mockToolResult: ToolResult = {
      success: true,
      output: 'File read successfully\nLine 1: content',
      durationMs: 50,
      truncated: false,
    }

    mockToolRegistry.execute = vi.fn().mockResolvedValue(mockToolResult)

    const toolCalls: ToolCall[] = [
      {
        id: 'test-call-3',
        name: 'read_file',
        arguments: { path: 'test.ts' },
      },
    ]

    const result = await executeTools(
      'assistant-msg-3',
      toolCalls,
      {
        toolRegistry: mockToolRegistry,
        sessionManager: mockSessionManager,
        sessionId: 'test-session',
        workdir: '/test',
        turnMetrics: {
          addToolTime: vi.fn(),
          addLLMCall: vi.fn(),
          buildStats: vi.fn(),
        } as unknown as TurnMetrics,
        signal: undefined,
        onMessage: mockOnMessage,
      },
      vi.fn(),
    )

    expect(result.toolMessages).toHaveLength(1)
    expect(result.toolMessages[0]?.content).toBe('File read successfully\nLine 1: content')
    expect(result.toolMessages[0]?.content).not.toContain('Error:')
  })

  it('executes multiple tool calls in parallel and maintains order', async () => {
    const executionOrder: number[] = []
    const completionOrder: number[] = []

    mockToolRegistry.execute = vi.fn().mockImplementation(async (_name: string, args: any, _context: any) => {
      const index = (args.index as number) ?? 0
      const delay = (args.delay as number) ?? 0
      executionOrder.push(index)
      await new Promise((resolve) => setTimeout(resolve, delay))
      completionOrder.push(index)
      return {
        success: true,
        output: `Tool ${index} output`,
        durationMs: delay,
        truncated: false,
      }
    })

    const toolCalls: ToolCall[] = [
      {
        id: 'call-1',
        name: 'run_command',
        arguments: { index: 0, delay: 100 },
      },
      {
        id: 'call-2',
        name: 'run_command',
        arguments: { index: 1, delay: 10 },
      },
      {
        id: 'call-3',
        name: 'run_command',
        arguments: { index: 2, delay: 50 },
      },
    ]

    const result = await executeTools(
      'assistant-msg-4',
      toolCalls,
      {
        toolRegistry: mockToolRegistry,
        sessionManager: mockSessionManager,
        sessionId: 'test-session',
        workdir: '/test',
        turnMetrics: {
          addToolTime: vi.fn(),
          addLLMCall: vi.fn(),
          buildStats: vi.fn(),
        } as unknown as TurnMetrics,
        signal: undefined,
        onMessage: mockOnMessage,
      },
      vi.fn(),
    )

    expect(result.toolMessages).toHaveLength(3)
    expect(result.toolMessages[2]?.content).toBe('Tool 2 output')
  })
})

// ============================================================================
// runTopLevelAgentLoop — assembleRequest invocation
// ============================================================================

describe('runTopLevelAgentLoop assembleRequest', () => {
  let mockEventStore: EventStore
  let mockSessionManager: SessionManager
  let mockLLMClient: any
  let mockTurnMetrics: TurnMetrics
  let assembleRequestMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    mockEventStore = {
      append: vi.fn(),
      getEvents: vi.fn().mockReturnValue([]),
      getLatestSeq: vi.fn().mockReturnValue(0),
      cleanupOldEvents: vi.fn().mockReturnValue(0),
    } as unknown as EventStore
    ;(getEventStore as any).mockReturnValue(mockEventStore)

    mockLLMClient = {
      getModel: vi.fn().mockReturnValue('test-model'),
    }

    mockTurnMetrics = {
      addToolTime: vi.fn(),
      addLLMCall: vi.fn(),
      buildStats: vi.fn().mockReturnValue({}),
    } as unknown as TurnMetrics

    assembleRequestMock = vi.fn().mockReturnValue({
      systemPrompt: 'test-system-prompt',
      messages: [],
    })
    ;(getAllInstructions as any).mockResolvedValue({ content: 'test instructions', files: [] })
    ;(getEnabledSkillMetadata as any).mockResolvedValue([])
  })

  function makeConfig(overrides?: Partial<TopLevelLoopConfig>): TopLevelLoopConfig {
    return {
      mode: 'planner',
      append: vi.fn(),
      sessionManager: mockSessionManager,
      sessionId: 'test-session',
      llmClient: mockLLMClient,
      statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'test-model' },
      assembleRequest: assembleRequestMock as any,
      getToolRegistry: () => ({ tools: [], definitions: [], execute: vi.fn() }) as any,
      getConversationMessages: vi.fn().mockResolvedValue([]),
      ...overrides,
    }
  }

  it('calls assembleRequest on each iteration', async () => {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({}),
      getModelCompactionThreshold: vi.fn().mockReturnValue(undefined),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    const promise = runTopLevelAgentLoop(makeConfig(), mockTurnMetrics)

    // The loop will try to stream LLM and fail, but we can check assembleRequest was called
    await expect(promise).rejects.toThrow()

    expect(assembleRequestMock).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// Compaction: rebuild cached context on new window
// ============================================================================

describe('runTopLevelAgentLoop compaction', () => {
  let mockEventStore: EventStore
  let mockSessionManager: SessionManager
  let mockLLMClient: any
  let mockTurnMetrics: TurnMetrics
  let assembleRequestMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    mockEventStore = {
      append: vi.fn(),
      getEvents: vi.fn().mockReturnValue([]),
      getLatestSeq: vi.fn().mockReturnValue(0),
      cleanupOldEvents: vi.fn().mockReturnValue(0),
    } as unknown as EventStore
    ;(getEventStore as any).mockReturnValue(mockEventStore)

    mockLLMClient = {
      getModel: vi.fn().mockReturnValue('test-model'),
    }

    mockTurnMetrics = {
      addToolTime: vi.fn(),
      addLLMCall: vi.fn(),
      buildStats: vi.fn().mockReturnValue({}),
    } as unknown as TurnMetrics

    assembleRequestMock = vi.fn().mockReturnValue({
      systemPrompt: 'test-system-prompt',
      messages: [],
    })
    ;(getAllInstructions as any).mockResolvedValue({ content: 'test instructions', files: [] })
    ;(getEnabledSkillMetadata as any).mockResolvedValue([])

    ;(consumeStreamGenerator as any).mockResolvedValue({
      content: 'compaction summary',
      toolCalls: [],
      segments: [{ type: 'text', content: 'compaction summary' }],
      usage: { promptTokens: 10, completionTokens: 5 },
      timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
      aborted: false,
      finishReason: 'stop',
      modelParams: {},
    })
  })

  function makeConfig(overrides?: Partial<TopLevelLoopConfig>): TopLevelLoopConfig {
    return {
      mode: 'planner',
      append: vi.fn(),
      sessionManager: mockSessionManager,
      sessionId: 'test-session',
      llmClient: mockLLMClient,
      statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'test-model' },
      assembleRequest: assembleRequestMock as any,
      getToolRegistry: () => ({ tools: [], definitions: [], execute: vi.fn() }) as any,
      getConversationMessages: vi.fn().mockResolvedValue([]),
      ...overrides,
    }
  }

  it('applies the fresh cached context when a new context window is created', async () => {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({}),
      getModelCompactionThreshold: vi.fn().mockReturnValue(undefined),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    const appendMock = vi.fn()
    const rebuildCachedContext = vi.fn().mockResolvedValue(undefined)

    await runTopLevelAgentLoop(
      makeConfig({
        append: appendMock,
        initialCompacting: true,
        rebuildCachedContext,
      }),
      mockTurnMetrics,
    )

    const compactedEvents = appendMock.mock.calls
      .map(([event]) => event)
      .filter((event: any) => event?.type === 'context.compacted')
    expect(compactedEvents).toHaveLength(1)
    expect(rebuildCachedContext).toHaveBeenCalledTimes(1)
  })

  it('gives up after a bounded number of corrections instead of looping forever when the model keeps calling tools during compaction', async () => {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({}),
      getModelCompactionThreshold: vi.fn().mockReturnValue(undefined),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    // The model refuses to stop calling tools even though compaction told it to.
    // Before the fix, every attempt below appended a correction and looped with
    // no upper bound — this mock would make the test hang forever.
    ;(consumeStreamGenerator as any).mockResolvedValue({
      content: '',
      toolCalls: [{ id: 'call-1', name: 'run_command', arguments: { command: 'ls' } }],
      segments: [{ type: 'tool_call', toolCallId: 'call-1' }],
      usage: { promptTokens: 10, completionTokens: 5 },
      timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
      aborted: false,
      finishReason: 'tool_calls',
      modelParams: {},
    })

    const appendMock = vi.fn()

    await runTopLevelAgentLoop(
      makeConfig({
        append: appendMock,
        initialCompacting: true,
      }),
      mockTurnMetrics,
    )

    // Bounded: one initial attempt plus MAX_COMPACTION_REJECTION_RETRIES retries.
    expect((consumeStreamGenerator as any).mock.calls.length).toBe(4)

    const correctionMessages = appendMock.mock.calls
      .map(([event]) => event)
      .filter((event: any) => event?.type === 'message.start' && event.data?.messageKind === 'correction')
    expect(correctionMessages).toHaveLength(3)

    const errorEvents = appendMock.mock.calls
      .map(([event]) => event)
      .filter((event: any) => event?.type === 'chat.error')
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].data.recoverable).toBe(true)

    // Each rejected attempt must close its assistant bubble instead of leaving
    // it stuck in isStreaming — otherwise the next request to the LLM backend
    // carries an unfinished assistant turn alongside the new one.
    const doneEvents = appendMock.mock.calls
      .map(([event]) => event)
      .filter((event: any) => event?.type === 'message.done')
    expect(doneEvents.length).toBeGreaterThanOrEqual(4)
  })

  it('does not overwrite the known context size when the LLM stream never reported usage', async () => {
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
        currentTokens: 65000,
        maxTokens: 80128,
        compactionCount: 0,
        dangerZone: true,
        canCompact: true,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(80128),
      getCurrentModelSettings: vi.fn().mockReturnValue({}),
      getModelCompactionThreshold: vi.fn().mockReturnValue(undefined),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    // A stream that completed successfully but whose backend never sent a
    // usage chunk (e.g. a backend that only reports usage on non-streaming
    // calls). Before the fix this zero was written straight into session
    // state, wiping out the real (high) context size and starving compaction
    // of the signal it needs to trigger.
    ;(consumeStreamGenerator as any).mockResolvedValueOnce({
      content: 'done',
      toolCalls: [],
      segments: [{ type: 'text', content: 'done' }],
      usage: { promptTokens: 0, completionTokens: 0, reported: false },
      timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
      aborted: false,
      finishReason: 'stop',
      modelParams: {},
    })

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics)

    expect(mockSessionManager.setCurrentContextSize).not.toHaveBeenCalled()
  })

  it('tags the compaction prompt with the sub-agent id when compacting a sub-agent context', async () => {
    // Regression test: appendCompactionPrompt used to omit subAgentId, so the
    // prompt landed in the top-level conversation instead of the sub-agent's
    // own — the sub-agent's own history (built strictly by subAgentId) never
    // saw it and kept appending back-to-back assistant turns with no user
    // turn between them, which backends reject with "Cannot have 2 or more
    // assistant messages at the end of the list."
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(80128),
      // Above the (80128 * 0.5) threshold for the first few calls (covering
      // the iteration that triggers compaction), then low so the loop
      // doesn't re-trigger compaction forever once the (mocked) summary
      // "succeeds".
      getSubAgentContextTokens: vi.fn().mockImplementation(
        (() => {
          let calls = 0
          return () => (calls++ < 3 ? 60000 : 100)
        })(),
      ),
      getCurrentModelSettings: vi.fn().mockReturnValue({}),
      getModelCompactionThreshold: vi.fn().mockReturnValue(0.5),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    const appendMock = vi.fn()

    await runTopLevelAgentLoop(
      makeConfig({
        append: appendMock,
        subAgentMetadata: { subAgentId: 'sub-1', subAgentType: 'explorer' },
        breakOnReturnValue: true,
      }),
      mockTurnMetrics,
    )

    const compactionPrompt = appendMock.mock.calls
      .map(([event]) => event)
      .find((event: any) => event?.type === 'message.start' && event.data?.messageKind === 'auto-prompt')
    expect(compactionPrompt?.data).toMatchObject({ subAgentId: 'sub-1', subAgentType: 'explorer' })
  })

  function makeCompactionSessionManager(): SessionManager {
    return {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({}),
      getModelCompactionThreshold: vi.fn().mockReturnValue(undefined),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any
  }

  it('requests a low reasoning effort for the compaction LLM call', async () => {
    // Regression test: compaction shares the session's normal reasoning
    // effort by default. On a reasoning model that can eat the whole (already
    // tight, since the window is nearly full) output budget just thinking,
    // that leaves nothing for the actual summary — see the empty-content and
    // truncation tests below for what that produces.
    mockSessionManager = makeCompactionSessionManager()

    await runTopLevelAgentLoop(makeConfig({ initialCompacting: true }), mockTurnMetrics)

    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs.reasoningEffort).toBe('low')
  })

  it('does not use raw thinkingContent as the compaction summary when content is empty', async () => {
    // Regression test: a reasoning model can spend its whole output budget
    // inside <think> and return empty final content. Falling back to
    // thinkingContent silently turned that raw, unstructured chain-of-thought
    // into the "summary" — producing a garbled continuation that loses track
    // of prior progress and drives the next window to re-explore from
    // scratch instead of picking up where the last one left off.
    mockSessionManager = makeCompactionSessionManager()

    ;(consumeStreamGenerator as any).mockResolvedValue({
      content: '',
      thinkingContent: 'Let me organize what I understand from this session: 1. This is a continuation...',
      toolCalls: [],
      segments: [{ type: 'thinking', content: 'Let me organize...' }],
      usage: { promptTokens: 10, completionTokens: 5 },
      timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
      aborted: false,
      finishReason: 'stop',
      modelParams: {},
    })

    const appendMock = vi.fn()
    await runTopLevelAgentLoop(makeConfig({ append: appendMock, initialCompacting: true }), mockTurnMetrics)

    const events = appendMock.mock.calls.map(([event]) => event)
    expect(events.some((e: any) => e?.type === 'context.compacted')).toBe(false)
    expect(events.some((e: any) => e?.type === 'chat.error')).toBe(true)
  })

  it('rejects a truncated compaction summary instead of using the partial output', async () => {
    // Regression test: when the compaction call hits its (tight) output
    // budget mid-generation, the backend reports finishReason: 'length' and
    // content is non-empty but cut off — often mid-sentence, and frequently
    // missing the "next steps" section entirely since COMPACTION_PROMPT asks
    // for that last. A truncated summary is rejected the same way an empty
    // one is, instead of being silently accepted as "good enough".
    mockSessionManager = makeCompactionSessionManager()

    ;(consumeStreamGenerator as any).mockResolvedValue({
      content: '# Work Notes Summary\n\n## Files read\n- `src/ecole_ai',
      toolCalls: [],
      segments: [{ type: 'text', content: '# Work Notes Summary...' }],
      usage: { promptTokens: 10, completionTokens: 5 },
      timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
      aborted: false,
      finishReason: 'length',
      modelParams: {},
    })

    const appendMock = vi.fn()
    await runTopLevelAgentLoop(makeConfig({ append: appendMock, initialCompacting: true }), mockTurnMetrics)

    const events = appendMock.mock.calls.map(([event]) => event)
    expect(events.some((e: any) => e?.type === 'context.compacted')).toBe(false)
    expect(events.some((e: any) => e?.type === 'chat.error')).toBe(true)
  })

  it('triggers compaction right after an oversized tool batch instead of waiting for the next (oversized) LLM call', async () => {
    // Regression test: the compaction-threshold check only ran once per LLM
    // call, using that call's own promptTokens. A single tool batch (a couple
    // of large file reads) can jump currentTokens from comfortably under
    // threshold to well over it in one hop — the overshoot was only detected
    // AFTER the next (now oversized) call, by which point compaction itself
    // had almost no output budget left. This asserts compaction fires
    // immediately once the projected tokens (current + just-added tool
    // results) cross the threshold, without a second full-size LLM call
    // happening first.
    const toolRegistry = {
      tools: [],
      definitions: [],
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: 'x'.repeat(40000), // 16 + 10000 = 10016 estimated tokens
        durationMs: 0,
        truncated: false,
      }),
    } as any

    mockSessionManager = makeCompactionSessionManager()
    // 80128-token window (matches the real ctx-size=80000 deployment).
    // headroom = min(15K, 80128*0.3) = 15K -> ceiling ~81.3% -> trigger ~65136.
    // currentTokens=60000 is below that on its own; +10016 from the tool
    // batch projects to 70016, which is over it.
    ;(mockSessionManager.getContextState as any).mockReturnValue({
      currentTokens: 60000,
      maxTokens: 80128,
      compactionCount: 0,
      dangerZone: false,
      canCompact: true,
      dynamicContextChanged: false,
    })
    ;(mockSessionManager.getCurrentModelContext as any).mockReturnValue(80128)
    ;(mockSessionManager.getModelCompactionThreshold as any).mockReturnValue(0.85)

    // Iteration 1: model requests a tool call; the default beforeEach mock
    // (content: 'compaction summary', finishReason: 'stop') answers every
    // call after that — which is exactly what the compaction turn itself
    // should receive.
    ;(consumeStreamGenerator as any).mockResolvedValueOnce({
      content: '',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }],
      segments: [],
      usage: { promptTokens: 10, completionTokens: 5 },
      timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
      aborted: false,
      finishReason: 'tool_calls',
      modelParams: { maxTokens: 10000 },
    })

    const appendMock = vi.fn()
    await runTopLevelAgentLoop(makeConfig({ append: appendMock, getToolRegistry: () => toolRegistry }), mockTurnMetrics)

    // 3 LLM calls: the tool-calling turn, the compaction turn it triggers
    // right afterward, then the natural continuation turn in the fresh
    // window — never a 4th+ call, which would mean an extra oversized normal
    // turn slipped in before compaction finally fired. The mocked responses
    // report a trivially small promptTokens (10), so the old (non-proactive)
    // check — which only trusts a completed call's own reported promptTokens
    // — would never see this overshoot at all; only the projection-based
    // check added here can catch it.
    expect((streamLLMPure as any).mock.calls.length).toBe(3)
    const events = appendMock.mock.calls.map(([event]) => event)
    expect(events.some((e: any) => e?.type === 'message.start' && e.data?.messageKind === 'auto-prompt')).toBe(true)
    expect(events.some((e: any) => e?.type === 'context.compacted')).toBe(true)
  })
})

// ============================================================================
// maxTokens clamping behavior
// ============================================================================

describe('maxTokens clamping', () => {
  let mockEventStore: EventStore
  let mockSessionManager: SessionManager
  let mockLLMClient: any
  let mockTurnMetrics: TurnMetrics
  let assembleRequestMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    mockEventStore = {
      append: vi.fn(),
      getEvents: vi.fn().mockReturnValue([]),
      getLatestSeq: vi.fn().mockReturnValue(0),
      cleanupOldEvents: vi.fn().mockReturnValue(0),
    } as unknown as EventStore
    ;(getEventStore as any).mockReturnValue(mockEventStore)

    mockLLMClient = {
      getModel: vi.fn().mockReturnValue('test-model'),
    }

    mockTurnMetrics = {
      addToolTime: vi.fn(),
      addLLMCall: vi.fn(),
      buildStats: vi.fn().mockReturnValue({}),
    } as unknown as TurnMetrics

    assembleRequestMock = vi.fn().mockReturnValue({
      systemPrompt: 'test-system-prompt',
      messages: [],
    })
    ;(getAllInstructions as any).mockResolvedValue({ content: 'test instructions', files: [] })
    ;(getEnabledSkillMetadata as any).mockResolvedValue([])

    // Make streamLLMPure return a result immediately so the loop doesn't hang
    ;(consumeStreamGenerator as any).mockResolvedValue({
      content: '',
      toolCalls: [],
      segments: [],
      usage: { promptTokens: 10, completionTokens: 5 },
      timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
      aborted: false,
      finishReason: 'stop',
      modelParams: {},
    })
  })

  function makeConfig(overrides?: Partial<TopLevelLoopConfig>): TopLevelLoopConfig {
    return {
      mode: 'planner',
      append: vi.fn(),
      sessionManager: mockSessionManager,
      sessionId: 'test-session',
      llmClient: mockLLMClient,
      statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'test-model' },
      assembleRequest: assembleRequestMock as any,
      getToolRegistry: () => ({ tools: [], definitions: [], execute: vi.fn() }) as any,
      getConversationMessages: vi.fn().mockResolvedValue([]),
      ...overrides,
    }
  }

  it('clamps maxTokens when context is partially full', async () => {
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
        currentTokens: 195000,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    // availableForOutput = 200000 - 195000 - 2048 reserve = 2952, requested 16384 → clamped to 2952
    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    expect(callArgs.modelSettings?.maxTokens).toBe(2952)
  })

  it('does not clamp sub-agent maxTokens against the parent session context', async () => {
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
        currentTokens: 300000,
        maxTokens: 500000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      getSubAgentContextTokens: vi.fn().mockReturnValue(0),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    await runTopLevelAgentLoop(
      makeConfig({ subAgentMetadata: { subAgentId: 'sub-1', subAgentType: 'explorer' } }),
      mockTurnMetrics,
    ).catch(() => {})

    // Parent session is way over the sub-agent model's window (300k > 200k):
    // the clamp must use the sub-agent's own (fresh) context, not the parent's.
    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    expect(callArgs.modelSettings?.maxTokens).not.toBe(256)
    expect(callArgs.modelSettings?.maxTokens).toBe(16384)
  })

  it('passes the sessionId to streamLLMPure for opencode session affinity', async () => {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    expect(callArgs.sessionId).toBe('test-session')
  })

  it('uses the profile defaultMaxTokens when no user maxTokens is configured', async () => {
    mockLLMClient = {
      getModel: vi.fn().mockReturnValue('qwen3.8-27b'),
    }
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      // No user-configured maxTokens → the profile default (50000) should apply
      getCurrentModelSettings: vi.fn().mockReturnValue({}),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    // availableForOutput = 200000 - 0 - 2048 reserve = 197952; requested 50000 → stays 50000
    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    expect(callArgs.modelSettings?.maxTokens).toBe(50000)
  })

  it('clamps a large profile default to a smaller context window', async () => {
    mockLLMClient = {
      getModel: vi.fn().mockReturnValue('qwen3.8-27b'),
    }
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
        currentTokens: 1000,
        maxTokens: 8192,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(8192),
      // No user-configured maxTokens → the profile default (50000) should apply,
      // but be clamped down to what fits in the small window.
      getCurrentModelSettings: vi.fn().mockReturnValue({}),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    // availableForOutput = 8192 - 1000 - 2048 reserve = 5144; requested 50000 → clamped to 5144
    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    expect(callArgs.modelSettings?.maxTokens).toBe(5144)
  })

  it('clamps maxTokens when user-configured maxTokens exceeds available space', async () => {
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
        currentTokens: 190000,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      // User configured a high maxTokens that exceeds available space
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 32000 }),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    // availableForOutput = 200000 - 190000 - 2048 reserve = 7952, requested 32000 → clamped to 7952
    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    expect(callArgs.modelSettings?.maxTokens).toBe(7952)
  })

  it('applies 256-token floor when context is over limit', async () => {
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
        currentTokens: 200000,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    // 200000 - 200000 = 0, floor is 256
    expect(callArgs.modelSettings?.maxTokens).toBe(256)
  })

  it('does not clamp when context is empty', async () => {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    // 200000 - 0 = 200000, requested 16384, so should remain 16384
    expect(callArgs.modelSettings?.maxTokens).toBe(16384)
  })

  it('resolves the context window with the session id (session-aware, not the global default)', async () => {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    // The clamp and truncation budget must resolve the SESSION model's window,
    // so the context lookup must be scoped to the session and its running agent.
    expect(mockSessionManager.getCurrentModelContext).toHaveBeenCalledWith('test-session', 'planner')
  })

  it('clamps against the session model context window, not the default model', async () => {
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
        currentTokens: 99000,
        maxTokens: 262000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      // Session-aware: 262K for the session model, 100K for the global default.
      getCurrentModelContext: vi.fn((sessionId?: string) => (sessionId ? 262000 : 100000)),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    // Session at 99K of a 262K window → available = 262000 - 99000 - 2048.
    // 16384 requested stays unclamped. If the DEFAULT (100K) window were used,
    // available would be max(256, -1048) = 256 and the request would be gutted.
    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    expect(callArgs.modelSettings?.maxTokens).toBe(16384)
  })

  it('floors the truncation retry maxTokens at 256 when promptTokens exceed the context window', async () => {
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
        currentTokens: 1000,
        maxTokens: 262000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      // Session-aware: 262K for the session model, 100K for the global default.
      getCurrentModelContext: vi.fn((sessionId?: string) => (sessionId ? 262000 : 100000)),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      getModelCompactionThreshold: vi.fn().mockReturnValue(undefined),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    // First call: truncated (finishReason length, promptTokens already past the
    // window). Second call: the retry with the recomputed budget, which must
    // never go negative.
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce({
        content: 'partial response',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 265000, completionTokens: 5000 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'length',
        modelParams: { maxTokens: 16384 },
      })
      .mockResolvedValueOnce({
        content: 'done',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 100, completionTokens: 10 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'stop',
        modelParams: { maxTokens: 256 },
      })

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    const calls = (streamLLMPure as any).mock.calls
    expect(calls.length).toBe(2)
    // 262000 - 265000 - 2048 = -5048 → floored to 256. A negative maxTokens
    // would be rejected by the backend (HTTP 400 "max_tokens must be at least 1").
    expect(calls[1]?.[0].modelSettings?.maxTokens).toBe(256)
  })

  it('passes promptTokens and completionTokens to setCurrentContextSize', async () => {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    // Simulate a real LLM call returning both input and output token usage
    ;(consumeStreamGenerator as any).mockResolvedValue({
      content: '',
      toolCalls: [],
      segments: [],
      usage: { promptTokens: 55100, completionTokens: 6030 },
      timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
      aborted: false,
      finishReason: 'stop',
      modelParams: {},
    })

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    // Both prompt AND completion tokens must flow into context tracking so the
    // next clamp knows the real context size (input + last output).
    expect(mockSessionManager.setCurrentContextSize).toHaveBeenCalledWith('test-session', 55100, 6030, undefined)
  })

  it('does not reset context size to zero when the LLM query fails', async () => {
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
        currentTokens: 78100,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    // Simulate a failed LLM call — the stream reports an error and yields zero usage.
    // Give up immediately so the test doesn't ride the real 30-min retry window.
    ;(consumeStreamGenerator as any).mockResolvedValue({
      content: '',
      toolCalls: [],
      segments: [],
      usage: { promptTokens: 0, completionTokens: 0 },
      timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
      aborted: false,
      finishReason: 'stop',
      modelParams: {},
      error: 'boom',
    })

    await runTopLevelAgentLoop(
      makeConfig({ llmRetryPolicy: { backoffMs: [0], minIntervalMs: 0, maxDurationMs: 60_000, maxAttempts: 1 } }),
      mockTurnMetrics,
    ).catch(() => {})

    // A failed query must NOT overwrite the last known context size with zero.
    expect(mockSessionManager.setCurrentContextSize).not.toHaveBeenCalled()
    expect(mockTurnMetrics.addLLMCall).not.toHaveBeenCalled()
  })

  it('passes undefined modelSettings when getCurrentModelSettings returns undefined', async () => {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue(undefined),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    // modelSettings should be undefined — no partial object created
    expect(callArgs.modelSettings).toBeUndefined()
  })

  it('warmup mode calls assembleRequest and llmClient.complete, does not call streamLLMPure', async () => {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    const completeMock = vi.fn().mockResolvedValue({
      id: 'warmup',
      content: '',
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    })
    mockLLMClient.complete = completeMock

    await runTopLevelAgentLoop(makeConfig({ warmup: true }), mockTurnMetrics)

    expect(assembleRequestMock).toHaveBeenCalledTimes(1)
    expect(assembleRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [],
        toolChoice: 'none',
      }),
    )
    expect(completeMock).toHaveBeenCalledTimes(1)
    expect(completeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 1,
        temperature: 0,
        modelSettings: { maxTokens: 16384 },
      }),
    )
    const callArgs = completeMock.mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    expect(callArgs.skipClientReasoningEffort).toBeUndefined()
    expect(streamLLMPure).not.toHaveBeenCalled()
  })

  it('passes the session project workdir (not the workspace) to getEnabledSkillMetadata', async () => {
    const projectRoot = '/actual/project/dir'
    const workspacePath = '/workspaces/openfox/review-branch'

    mockSessionManager = {
      enterPauseGate: vi.fn().mockResolvedValue('released'),
      requireSession: vi.fn().mockReturnValue({
        workdir: projectRoot,
        projectId: 'test-project',
        executionState: null,
        criteria: [],
        isRunning: false,
      }),
      getEffectiveWorkdir: vi.fn().mockReturnValue(workspacePath),
      getProjectWorkdir: vi.fn().mockReturnValue(projectRoot),
      getContextState: vi.fn().mockReturnValue({
        currentTokens: 0,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    const completeMock = vi.fn().mockResolvedValue({
      id: 'warmup',
      content: '',
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    })
    mockLLMClient.complete = completeMock

    vi.mocked(getEnabledSkillMetadata).mockClear()

    await runTopLevelAgentLoop(makeConfig({ warmup: true }), mockTurnMetrics)

    expect(getEnabledSkillMetadata).toHaveBeenCalledWith('/test/config', projectRoot)
    expect(getEnabledSkillMetadata).not.toHaveBeenCalledWith('/test/config', workspacePath)
  })

  it('subtracts estimated tool-result tokens from the maxTokens clamp', async () => {
    const toolRegistry = {
      tools: [],
      definitions: [],
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: 'x'.repeat(4000), // ~1000 tokens at 4 chars/token + 16 overhead
        durationMs: 0,
        truncated: false,
      }),
    } as any

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
        currentTokens: 5000,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 200000 }),
      getModelCompactionThreshold: vi.fn().mockReturnValue(1.0),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    // Iteration 1: tool batch returning a large result; iteration 2: terminates.
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'tool_calls',
        modelParams: { maxTokens: 192952 },
      })
      .mockResolvedValue({
        content: 'done',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
      })

    await runTopLevelAgentLoop(makeConfig({ getToolRegistry: () => toolRegistry }), mockTurnMetrics).catch(() => {})

    // First call: available = 200000 - 5000 - 2048 = 192952.
    // Tool result (4000 chars) estimated at 16 + 1000 = 1016 tokens.
    // Second call: available = 192952 - 1016 = 191936.
    const secondCall = (streamLLMPure as any).mock.calls[1]?.[0]
    expect(secondCall).toBeDefined()
    expect(secondCall.modelSettings?.maxTokens).toBe(191936)
  })

  it('does not double-count tool-result tokens once they are reflected in promptTokens', async () => {
    const toolRegistry = {
      tools: [],
      definitions: [],
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: 'x'.repeat(4000), // 16 + 1000 = 1016 tokens per batch
        durationMs: 0,
        truncated: false,
      }),
    } as any

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
        currentTokens: 5000,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 200000 }),
      getModelCompactionThreshold: vi.fn().mockReturnValue(1.0),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    // Iteration 1: tool batch; iteration 2: tool batch; iteration 3: terminates.
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'tool_calls',
        modelParams: { maxTokens: 192952 },
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-2', name: 'read_file', arguments: { path: 'b.ts' } }],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'tool_calls',
        modelParams: { maxTokens: 191936 },
      })
      .mockResolvedValue({
        content: 'done',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
      })

    await runTopLevelAgentLoop(makeConfig({ getToolRegistry: () => toolRegistry }), mockTurnMetrics).catch(() => {})

    // Iteration 3 must subtract only iteration 2's estimate (1016), not 2032:
    // iteration 1's results are already counted in iteration 2's promptTokens.
    const thirdCall = (streamLLMPure as any).mock.calls[2]?.[0]
    expect(thirdCall).toBeDefined()
    expect(thirdCall.modelSettings?.maxTokens).toBe(191936)
  })

  it('retries immediately with halved maxTokens on a context-length error', async () => {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      getModelCompactionThreshold: vi.fn().mockReturnValue(1.0),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
        error:
          "HTTP 400: This model's maximum context length is 128000 tokens. However, you requested 130000 tokens (120000 in the messages, 10000 in the completion).",
      })
      .mockResolvedValue({
        content: 'done',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
      })

    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics).catch(() => {})

    const calls = (streamLLMPure as any).mock.calls
    expect(calls.length).toBe(2)
    // First call requested 16384; the context-length retry halves it to 8192.
    expect(calls[0]?.[0].modelSettings?.maxTokens).toBe(16384)
    expect(calls[1]?.[0].modelSettings?.maxTokens).toBe(8192)
  })

  it('gives up after exhausting context-length retries and falls through to the failure path', async () => {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      getModelCompactionThreshold: vi.fn().mockReturnValue(1.0),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    const contextError =
      "HTTP 400: This model's maximum context length is 128000 tokens. However, you requested 130000 tokens."
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
        error: contextError,
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
        error: contextError,
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
        error: contextError,
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
        error: contextError,
      })

    await runTopLevelAgentLoop(
      makeConfig({ llmRetryPolicy: { backoffMs: [0], minIntervalMs: 0, maxDurationMs: 60_000, maxAttempts: 1 } }),
      mockTurnMetrics,
    ).catch(() => {})

    const calls = (streamLLMPure as any).mock.calls
    // 1 initial + 3 halving retries; the 4th failure exhausts the budget and
    // falls through to the normal failure path (maxAttempts 1 → give up).
    expect(calls.length).toBe(4)
    expect(calls[0]?.[0].modelSettings?.maxTokens).toBe(16384)
    expect(calls[1]?.[0].modelSettings?.maxTokens).toBe(8192)
    expect(calls[2]?.[0].modelSettings?.maxTokens).toBe(4096)
    expect(calls[3]?.[0].modelSettings?.maxTokens).toBe(2048)
  })

  it('applies the context-length halving even when config.modelSettings is set', async () => {
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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      getModelCompactionThreshold: vi.fn().mockReturnValue(1.0),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
        error:
          "HTTP 400: This model's maximum context length is 128000 tokens. However, you requested 130000 tokens (120000 in the messages, 10000 in the completion).",
      })
      .mockResolvedValue({
        content: 'done',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
      })

    await runTopLevelAgentLoop(
      makeConfig({ modelSettings: { temperature: 0.5, maxTokens: 16384 } }),
      mockTurnMetrics,
    ).catch(() => {})

    const calls = (streamLLMPure as any).mock.calls
    expect(calls.length).toBe(2)
    // The halving override must win over config.modelSettings, otherwise the
    // retry would re-request the same too-large maxTokens.
    expect(calls[1]?.[0].modelSettings?.maxTokens).toBe(8192)
    expect(calls[1]?.[0].modelSettings?.temperature).toBe(0.5)
  })

  it('resets the maxTokens override after a successful call', async () => {
    const toolRegistry = {
      tools: [],
      definitions: [],
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: 'x'.repeat(4000),
        durationMs: 0,
        truncated: false,
      }),
    } as any

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
        currentTokens: 5000,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 16384 }),
      getModelCompactionThreshold: vi.fn().mockReturnValue(1.0),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any

    // Iteration 1: truncated (length) → the truncation retry grows the override to 24576.
    // Iteration 2: tool batch using the override → success resets it.
    // Iteration 3: terminates; must go back to the user's maxTokens.
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce({
        content: 'partial',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'length',
        modelParams: { maxTokens: 16384 },
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'tool_calls',
        modelParams: { maxTokens: 24576 },
      })
      .mockResolvedValue({
        content: 'done',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
      })

    await runTopLevelAgentLoop(makeConfig({ getToolRegistry: () => toolRegistry }), mockTurnMetrics).catch(() => {})

    const calls = (streamLLMPure as any).mock.calls
    expect(calls.length).toBe(3)
    expect(calls[1]?.[0].modelSettings?.maxTokens).toBe(24576)
    // After iteration 2 succeeded, the override is reset → user maxTokens (clamped).
    expect(calls[2]?.[0].modelSettings?.maxTokens).toBe(16384)
  })
})

// ============================================================================
// Live turn stats — chat.stats streamed to the client as each LLM call completes
// ============================================================================

describe('runTopLevelAgentLoop live stats', () => {
  let mockEventStore: EventStore
  let mockSessionManager: SessionManager
  let mockLLMClient: any
  let mockTurnMetrics: TurnMetrics
  let assembleRequestMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    mockEventStore = {
      append: vi.fn(),
      getEvents: vi.fn().mockReturnValue([]),
      getLatestSeq: vi.fn().mockReturnValue(0),
      cleanupOldEvents: vi.fn().mockReturnValue(0),
    } as unknown as EventStore
    ;(getEventStore as any).mockReturnValue(mockEventStore)

    mockLLMClient = {
      getModel: vi.fn().mockReturnValue('test-model'),
    }

    mockTurnMetrics = {
      addToolTime: vi.fn(),
      addLLMCall: vi.fn(),
      buildStats: vi.fn().mockReturnValue({}),
    } as unknown as TurnMetrics

    assembleRequestMock = vi.fn().mockReturnValue({
      systemPrompt: 'test-system-prompt',
      messages: [],
    })
    ;(getAllInstructions as any).mockResolvedValue({ content: 'test instructions', files: [] })
    ;(getEnabledSkillMetadata as any).mockResolvedValue([])
    ;(consumeStreamGenerator as any).mockResolvedValue({
      content: 'done',
      toolCalls: [],
      segments: [],
      usage: { promptTokens: 10, completionTokens: 5 },
      timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
      aborted: false,
      finishReason: 'stop',
      modelParams: {},
    })

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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({}),
      getModelCompactionThreshold: vi.fn().mockReturnValue(undefined),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any
  })

  function makeConfig(overrides?: Partial<TopLevelLoopConfig>): TopLevelLoopConfig {
    return {
      mode: 'planner',
      append: vi.fn(),
      sessionManager: mockSessionManager,
      sessionId: 'test-session',
      llmClient: mockLLMClient,
      statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'test-model' },
      assembleRequest: assembleRequestMock as any,
      getToolRegistry: () => ({ tools: [], definitions: [], execute: vi.fn() }) as any,
      getConversationMessages: vi.fn().mockResolvedValue([]),
      ...overrides,
    }
  }

  function chatStatsCount(onMessage: ReturnType<typeof vi.fn>): number {
    return onMessage.mock.calls.filter((args: unknown[]) => (args[0] as { type?: string }).type === 'chat.stats').length
  }

  it('emits chat.stats with cumulative stats after a successful LLM call', async () => {
    const onMessage = vi.fn()

    await runTopLevelAgentLoop(makeConfig({ onMessage }), mockTurnMetrics)

    expect(chatStatsCount(onMessage)).toBeGreaterThanOrEqual(1)
    const statsMessage = onMessage.mock.calls
      .map((args: unknown[]) => args[0] as { type: string; payload: { stats: unknown } })
      .find((msg) => msg.type === 'chat.stats')
    expect(statsMessage?.payload.stats).toBeDefined()
  })

  it('does not emit chat.stats for sub-agent runs', async () => {
    const onMessage = vi.fn()

    await runTopLevelAgentLoop(
      makeConfig({
        onMessage,
        subAgentMetadata: { subAgentId: 'sub-1', subAgentType: 'verifier' },
      }),
      mockTurnMetrics,
    )

    expect(chatStatsCount(onMessage)).toBe(0)
  })
})

// ============================================================================
// Queue draining — sub-agent runs must not drain the user queue mid-run
// ============================================================================

describe('runTopLevelAgentLoop queue draining', () => {
  let mockEventStore: EventStore
  let mockSessionManager: any
  let mockLLMClient: any
  let mockTurnMetrics: TurnMetrics
  let mockToolRegistry: ToolRegistry
  let assembleRequestMock: ReturnType<typeof vi.fn>
  let mockAppend: ReturnType<typeof vi.fn>
  const queuedMessage = {
    queueId: 'q1',
    mode: 'asap' as const,
    content: 'Hello from the queue',
    queuedAt: new Date().toISOString(),
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockEventStore = {
      append: vi.fn(),
      getEvents: vi.fn().mockReturnValue([]),
      getLatestSeq: vi.fn().mockReturnValue(0),
      cleanupOldEvents: vi.fn().mockReturnValue(0),
    } as unknown as EventStore
    ;(getEventStore as any).mockReturnValue(mockEventStore)

    mockLLMClient = {
      getModel: vi.fn().mockReturnValue('test-model'),
    }

    mockTurnMetrics = {
      addToolTime: vi.fn(),
      addLLMCall: vi.fn(),
      buildStats: vi.fn().mockReturnValue({}),
    } as unknown as TurnMetrics

    assembleRequestMock = vi.fn().mockReturnValue({
      systemPrompt: 'test-system-prompt',
      messages: [],
    })
    ;(getAllInstructions as any).mockResolvedValue({ content: 'test instructions', files: [] })
    ;(getEnabledSkillMetadata as any).mockResolvedValue([])

    mockToolRegistry = {
      tools: [],
      definitions: [],
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: 'ok',
        durationMs: 0,
        truncated: false,
      }),
    } as unknown as ToolRegistry

    // Iteration 1: a tool batch (reaches drainQueue), iteration 2: no tools (terminates)
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
      })
      .mockResolvedValue({
        content: '',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
        aborted: false,
        finishReason: 'stop',
        modelParams: {},
      })

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
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({}),
      getModelCompactionThreshold: vi.fn().mockReturnValue(undefined),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([queuedMessage]),
      getQueueState: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
    } as any
  })

  function makeConfig(overrides?: Partial<TopLevelLoopConfig>): TopLevelLoopConfig {
    mockAppend = vi.fn()
    return {
      mode: 'planner',
      append: mockAppend as any,
      sessionManager: mockSessionManager,
      sessionId: 'test-session',
      llmClient: mockLLMClient,
      statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'test-model' },
      assembleRequest: assembleRequestMock as any,
      getToolRegistry: () => mockToolRegistry as any,
      getConversationMessages: vi.fn().mockResolvedValue([]),
      onMessage: vi.fn(),
      ...overrides,
    }
  }

  it('drains queued messages in a regular (non-sub-agent) turn', async () => {
    await runTopLevelAgentLoop(makeConfig(), mockTurnMetrics)

    expect(mockSessionManager.drainAsapMessages).toHaveBeenCalled()
    const appended = mockAppend.mock.calls.flat()
    const queuedInHistory = appended.filter(
      (e: any) => e?.type === 'message.start' && e.data?.role === 'user' && e.data?.content === 'Hello from the queue',
    )
    expect(queuedInHistory.length).toBeGreaterThan(0)
  })

  it('does not drain queued messages during a sub-agent run', async () => {
    await runTopLevelAgentLoop(
      makeConfig({ subAgentMetadata: { subAgentId: 'sub-1', subAgentType: 'explorer' } }),
      mockTurnMetrics,
    )

    expect(mockSessionManager.drainAsapMessages).not.toHaveBeenCalled()
    const appended = mockAppend.mock.calls.flat()
    const queuedInHistory = appended.filter(
      (e: any) => e?.type === 'message.start' && e.data?.content === 'Hello from the queue',
    )
    expect(queuedInHistory).toHaveLength(0)
  })
})
