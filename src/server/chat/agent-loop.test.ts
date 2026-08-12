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

    // availableForOutput = 200000 - 195000 = 5000, requested 16384 → clamped to 5000
    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    expect(callArgs.modelSettings?.maxTokens).toBe(5000)
  })

  it('clamps maxTokens when user-configured maxTokens exceeds available space', async () => {
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

    // availableForOutput = 200000 - 190000 = 10000, requested 32000 → clamped to 10000
    const callArgs = (streamLLMPure as any).mock.calls[0]?.[0]
    expect(callArgs).toBeDefined()
    expect(callArgs.modelSettings?.maxTokens).toBe(10000)
  })

  it('applies 256-token floor when context is over limit', async () => {
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

  it('passes promptTokens and completionTokens to setCurrentContextSize', async () => {
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
