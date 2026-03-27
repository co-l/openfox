import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolResult, ToolCall } from '../../shared/types.js'
import type { SessionManager } from '../session/index.js'
import type { ToolRegistry } from '../tools/types.js'
import type { TurnMetrics } from './stream-pure.js'
import type { EventStore } from '../events/store.js'

// Mock the event store module
vi.mock('../events/store.js', () => ({
  getEventStore: vi.fn(),
}))

import { executeToolBatch } from './agent-loop.js'
import { getEventStore } from '../events/store.js'

describe('executeToolBatch', () => {
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
      drainAsapMessages: vi.fn().mockReturnValue([]),
    } as unknown as SessionManager

    mockToolRegistry = {
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

    const result = await executeToolBatch('assistant-msg-1', toolCalls, {
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
    })

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

    const result = await executeToolBatch('assistant-msg-2', toolCalls, {
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
    })

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

    const result = await executeToolBatch('assistant-msg-3', toolCalls, {
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
    })

    expect(result.toolMessages).toHaveLength(1)
    expect(result.toolMessages[0]?.content).toBe('File read successfully\nLine 1: content')
    expect(result.toolMessages[0]?.content).not.toContain('Error:')
  })
})
