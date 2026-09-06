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
