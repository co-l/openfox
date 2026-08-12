import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolCall } from '../../shared/types.js'
import type { TurnMetrics } from './stream-pure.js'
import type { ToolRegistry } from '../tools/types.js'
import type { TurnEvent } from '../events/types.js'
import { executeTools, transformSubAgentAliases } from './execute-tools.js'

vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn(),
  findAgentById: vi.fn(),
}))

describe('executeTools', () => {
  const mockToolRegistry = {
    tools: [] as Array<{ name: string }>,
    execute: vi.fn(),
    definitions: [],
  } as unknown as ToolRegistry

  const mockTurnMetrics = {
    addToolTime: vi.fn(),
  } as unknown as TurnMetrics

  function makeCtx(overrides?: Record<string, unknown>) {
    return {
      toolRegistry: mockToolRegistry,
      sessionManager: {
        getLspManager: vi.fn(),
        getEffectiveWorkdir: vi.fn().mockReturnValue('/test'),
        getProjectWorkdir: vi.fn().mockReturnValue('/test'),
      } as any,
      sessionId: 'test-session',
      workdir: '/test',
      turnMetrics: mockTurnMetrics,
      signal: undefined,
      onMessage: undefined,
      llmClient: undefined,
      statsIdentity: undefined,
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends tool.call events via append callback', async () => {
    const append = vi.fn()
    mockToolRegistry.execute = vi.fn().mockResolvedValue({
      success: true,
      output: 'done',
      durationMs: 10,
      truncated: false,
    })

    const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'run_command', arguments: { command: 'echo hi' } }]

    await executeTools('msg-1', toolCalls, makeCtx(), append)

    const callEvents = append.mock.calls.filter((args: unknown[]) => (args[0] as TurnEvent).type === 'tool.call')
    expect(callEvents).toHaveLength(1)
    expect(callEvents[0]![0] as TurnEvent).toMatchObject({
      type: 'tool.call',
      data: { messageId: 'msg-1', toolCall: { id: 'call-1', name: 'run_command' } },
    })
  })

  it('appends tool.result events via append callback', async () => {
    const append = vi.fn()
    mockToolRegistry.execute = vi.fn().mockResolvedValue({
      success: true,
      output: 'done',
      durationMs: 10,
      truncated: false,
    })

    const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'run_command', arguments: { command: 'echo hi' } }]

    await executeTools('msg-1', toolCalls, makeCtx(), append)

    const resultEvents = append.mock.calls.filter((args: unknown[]) => (args[0] as TurnEvent).type === 'tool.result')
    expect(resultEvents).toHaveLength(1)
    expect(resultEvents[0]![0] as TurnEvent).toMatchObject({
      type: 'tool.result',
      data: { messageId: 'msg-1', toolCallId: 'call-1' },
    })
  })

  it('executes multiple tool calls in parallel and maintains order', async () => {
    const append = vi.fn()
    const executionOrder: number[] = []
    const completionOrder: number[] = []

    mockToolRegistry.execute = vi.fn().mockImplementation(async (_name: string, args: any) => {
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
      { id: 'call-1', name: 'run_command', arguments: { index: 0, delay: 100 } },
      { id: 'call-2', name: 'run_command', arguments: { index: 1, delay: 10 } },
      { id: 'call-3', name: 'run_command', arguments: { index: 2, delay: 50 } },
    ]

    const result = await executeTools('msg-1', toolCalls, makeCtx(), append)

    expect(result.toolMessages).toHaveLength(3)
    expect(result.toolMessages[0]?.content).toBe('Tool 0 output')
    expect(result.toolMessages[1]?.content).toBe('Tool 1 output')
    expect(result.toolMessages[2]?.content).toBe('Tool 2 output')
  })

  it('includes output and error when tool fails with output', async () => {
    const append = vi.fn()
    mockToolRegistry.execute = vi.fn().mockResolvedValue({
      success: false,
      output: 'TypeScript error output\nLine 1: error TS123',
      error: 'Command exited with code 2',
      durationMs: 100,
      truncated: false,
    })

    const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'run_command', arguments: { command: 'npm run typecheck' } }]

    const result = await executeTools('msg-1', toolCalls, makeCtx(), append)

    expect(result.toolMessages).toHaveLength(1)
    expect(result.toolMessages[0]?.content).toContain('TypeScript error output')
    expect(result.toolMessages[0]?.content).toContain('Error: Command exited with code 2')
  })

  it('shows only error when tool fails without output', async () => {
    const append = vi.fn()
    mockToolRegistry.execute = vi.fn().mockResolvedValue({
      success: false,
      error: 'Criterion not found: missing',
      durationMs: 0,
      truncated: false,
    })

    const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'update_criterion', arguments: { id: 'missing' } }]

    const result = await executeTools('msg-1', toolCalls, makeCtx(), append)

    expect(result.toolMessages).toHaveLength(1)
    expect(result.toolMessages[0]?.content).toBe('Error: Criterion not found: missing')
  })

  it('tracks tool time via turnMetrics', async () => {
    const append = vi.fn()
    const addToolTime = vi.fn()
    mockToolRegistry.execute = vi.fn().mockResolvedValue({
      success: true,
      output: 'done',
      durationMs: 42,
      truncated: false,
    })

    const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'run_command', arguments: { command: 'echo hi' } }]

    await executeTools('msg-1', toolCalls, { ...makeCtx(), turnMetrics: { addToolTime } as any }, append)

    expect(addToolTime).toHaveBeenCalledTimes(1)
    expect(typeof vi.mocked(addToolTime).mock.calls[0]![0]).toBe('number')
  })

  it('handles parse errors without calling tool registry', async () => {
    const append = vi.fn()
    const execute = vi.fn()

    const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'run_command', arguments: {}, parseError: 'Invalid JSON' }]

    const result = await executeTools(
      'msg-1',
      toolCalls,
      { ...makeCtx(), toolRegistry: { tools: [], execute, definitions: [] } as any },
      append,
    )

    expect(execute).not.toHaveBeenCalled()
    expect(result.toolMessages).toHaveLength(1)
    expect(result.toolMessages[0]?.content).toContain('Failed to parse')
  })

  it('throws Aborted when signal is aborted before tool calls are emitted', async () => {
    const append = vi.fn()
    const controller = new AbortController()
    controller.abort()

    const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'run_command', arguments: { command: 'echo hi' } }]

    await expect(executeTools('msg-1', toolCalls, makeCtx({ signal: controller.signal }), append)).rejects.toThrow(
      'Aborted',
    )
    // No tool.call events should have been emitted
    expect(append.mock.calls.filter((args: unknown[]) => (args[0] as TurnEvent).type === 'tool.call')).toHaveLength(0)
  })

  it('returns interrupted results when abort fires mid-execution', async () => {
    const append = vi.fn()
    const controller = new AbortController()

    mockToolRegistry.execute = vi.fn().mockImplementation(async () => {
      controller.abort()
      throw new Error('Aborted')
    })

    const toolCalls: ToolCall[] = [
      { id: 'call-1', name: 'run_command', arguments: { command: 'echo hi' } },
      { id: 'call-2', name: 'read_file', arguments: { path: 'test.txt' } },
    ]

    const result = await executeTools('msg-1', toolCalls, makeCtx({ signal: controller.signal }), append)

    // tool.call events should have been emitted for both
    const callEvents = append.mock.calls.filter((args: unknown[]) => (args[0] as TurnEvent).type === 'tool.call')
    expect(callEvents).toHaveLength(2)

    // Both tools should have interrupted results
    const resultEvents = append.mock.calls.filter((args: unknown[]) => (args[0] as TurnEvent).type === 'tool.result')
    expect(resultEvents).toHaveLength(2)
    for (const [event] of resultEvents) {
      const te = event as TurnEvent
      expect(te.type).toBe('tool.result')
      const data = te.data as { result: { success: boolean; error?: string } }
      expect(data.result.success).toBe(false)
      expect(data.result.error).toContain('interrupted')
    }

    // toolMessages should contain interrupted messages
    expect(result.toolMessages).toHaveLength(2)
    expect(result.toolMessages[0]?.content).toBe('Error: Tool execution was interrupted by user')
    expect(result.toolMessages[1]?.content).toBe('Error: Tool execution was interrupted by user')
  })

  it('detects step_done tool and sets stepDoneCalled in result', async () => {
    const append = vi.fn()
    mockToolRegistry.execute = vi.fn().mockResolvedValue({
      success: true,
      output: 'Step completion signal recorded.',
      durationMs: 0,
      truncated: false,
    })

    const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'step_done', arguments: {} }]

    const result = await executeTools('msg-1', toolCalls, makeCtx(), append)

    expect(result.stepDoneCalled).toBe(true)
  })

  it('does not set stepDoneCalled when step_done fails', async () => {
    const append = vi.fn()
    mockToolRegistry.execute = vi.fn().mockResolvedValue({
      success: false,
      error: 'Something went wrong',
      durationMs: 0,
      truncated: false,
    })

    const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'step_done', arguments: {} }]

    const result = await executeTools('msg-1', toolCalls, makeCtx(), append)

    expect(result.stepDoneCalled).toBe(false)
  })

  it('sets stepDoneCalled when step_done has a parseError', async () => {
    const append = vi.fn()
    mockToolRegistry.execute = vi.fn().mockResolvedValue({
      success: true,
      output: 'Step completion signal recorded.',
      durationMs: 0,
      truncated: false,
    })

    const toolCalls: ToolCall[] = [
      { id: 'call-1', name: 'step_done', arguments: {}, parseError: 'Unexpected end of JSON input', rawArguments: '{' },
    ]

    const result = await executeTools('msg-1', toolCalls, makeCtx(), append)

    expect(result.stepDoneCalled).toBe(true)
  })

  describe('sub-agent alias transform', () => {
    const mockExplorerDef = {
      metadata: {
        id: 'explorer',
        name: 'Explorer',
        description: 'Explore',
        subagent: true,
        allowedTools: [] as string[],
      },
      prompt: 'Explore.',
    }
    const mockVerifierDef = {
      metadata: {
        id: 'verifier',
        name: 'Verifier',
        description: 'Verify',
        subagent: true,
        allowedTools: [] as string[],
      },
      prompt: 'Verify.',
    }
    const mockAgents = [mockExplorerDef, mockVerifierDef]

    beforeEach(async () => {
      vi.clearAllMocks()
      const { loadAllAgentsDefault, findAgentById } = await import('../agents/registry.js')
      vi.mocked(loadAllAgentsDefault).mockResolvedValue(mockAgents)
      vi.mocked(findAgentById).mockImplementation((id: string, agents: typeof mockAgents) =>
        agents.find((a) => a.metadata.id === id),
      )
    })

    it('transforms explorer tool call to call_sub_agent in place', async () => {
      const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'explorer', arguments: { prompt: 'find the entry point' } }]
      const registry = { tools: [{ name: 'call_sub_agent' }] } as unknown as ToolRegistry

      await transformSubAgentAliases(toolCalls, registry)

      expect(toolCalls[0]!.name).toBe('call_sub_agent')
      expect(toolCalls[0]!.arguments).toEqual({
        subAgentType: 'explorer',
        prompt: 'find the entry point',
      })
    })

    it('does not transform unknown tool names', async () => {
      const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'read_file', arguments: { path: 'test.txt' } }]
      const registry = { tools: [{ name: 'call_sub_agent' }] } as unknown as ToolRegistry

      await transformSubAgentAliases(toolCalls, registry)

      expect(toolCalls[0]!.name).toBe('read_file')
      expect(toolCalls[0]!.arguments).toEqual({ path: 'test.txt' })
    })

    it('does not transform if call_sub_agent is not in the registry', async () => {
      const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'explorer', arguments: { prompt: 'find stuff' } }]
      const registry = { tools: [] } as unknown as ToolRegistry

      await transformSubAgentAliases(toolCalls, registry)

      expect(toolCalls[0]!.name).toBe('explorer')
    })

    it('extracts prompt from query fallback key', async () => {
      const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'explorer', arguments: { query: 'find the entry point' } }]
      const registry = { tools: [{ name: 'call_sub_agent' }] } as unknown as ToolRegistry

      await transformSubAgentAliases(toolCalls, registry)

      expect(toolCalls[0]!.name).toBe('call_sub_agent')
      expect(toolCalls[0]!.arguments).toEqual({
        subAgentType: 'explorer',
        prompt: 'find the entry point',
      })
    })

    it('extracts prompt from task fallback key', async () => {
      const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'explorer', arguments: { task: 'find the entry point' } }]
      const registry = { tools: [{ name: 'call_sub_agent' }] } as unknown as ToolRegistry

      await transformSubAgentAliases(toolCalls, registry)

      expect(toolCalls[0]!.name).toBe('call_sub_agent')
      expect(toolCalls[0]!.arguments).toEqual({
        subAgentType: 'explorer',
        prompt: 'find the entry point',
      })
    })

    it('uses tool name as subAgentType even when conflicting subAgentType is passed', async () => {
      const toolCalls: ToolCall[] = [
        { id: 'call-1', name: 'explorer', arguments: { subAgentType: 'verifier', prompt: 'find stuff' } },
      ]
      const registry = { tools: [{ name: 'call_sub_agent' }] } as unknown as ToolRegistry

      await transformSubAgentAliases(toolCalls, registry)

      expect(toolCalls[0]!.name).toBe('call_sub_agent')
      expect(toolCalls[0]!.arguments).toEqual({
        subAgentType: 'explorer',
        prompt: 'find stuff',
      })
    })

    it('works for any sub-agent ID', async () => {
      const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'verifier', arguments: { prompt: 'verify criteria' } }]
      const registry = { tools: [{ name: 'call_sub_agent' }] } as unknown as ToolRegistry

      await transformSubAgentAliases(toolCalls, registry)

      expect(toolCalls[0]!.name).toBe('call_sub_agent')
      expect(toolCalls[0]!.arguments).toEqual({
        subAgentType: 'verifier',
        prompt: 'verify criteria',
      })
    })

    it('resolves sub-agent aliases from the session project workdir', async () => {
      const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'explorer', arguments: { prompt: 'find stuff' } }]
      const registry = { tools: [{ name: 'call_sub_agent' }] } as unknown as ToolRegistry

      await transformSubAgentAliases(toolCalls, registry, '/original/project')

      const { loadAllAgentsDefault } = await import('../agents/registry.js')
      expect(loadAllAgentsDefault).toHaveBeenCalledWith('/original/project')
    })

    it('emits transformed tool.call events via executeTools', async () => {
      const append = vi.fn()
      const mockExecute = vi.fn().mockResolvedValue({
        success: true,
        output: 'sub-agent result',
        durationMs: 10,
        truncated: false,
      })
      const registry = {
        tools: [{ name: 'call_sub_agent' }],
        execute: mockExecute,
        definitions: [],
      } as unknown as ToolRegistry

      const toolCalls: ToolCall[] = [{ id: 'call-1', name: 'explorer', arguments: { prompt: 'find the entry point' } }]

      await executeTools('msg-1', toolCalls, makeCtx({ toolRegistry: registry }), append)

      const callEvents = append.mock.calls.filter((args: unknown[]) => (args[0] as TurnEvent).type === 'tool.call')
      expect(callEvents).toHaveLength(1)
      const event = callEvents[0]![0] as TurnEvent
      expect(event.type).toBe('tool.call')
      const data = event.data as { toolCall: ToolCall }
      expect(data.toolCall.name).toBe('call_sub_agent')
      expect(data.toolCall.arguments).toEqual({
        subAgentType: 'explorer',
        prompt: 'find the entry point',
      })
    })
  })

  it('detects return_value tool and includes it in result', async () => {
    const append = vi.fn()
    mockToolRegistry.execute = vi.fn().mockResolvedValue({
      success: true,
      output: 'return value content',
      durationMs: 10,
      truncated: false,
    })

    const toolCalls: ToolCall[] = [
      { id: 'call-1', name: 'return_value', arguments: { content: 'my result', result: 'completed' } },
    ]

    const result = await executeTools('msg-1', toolCalls, makeCtx(), append)

    expect(result.returnValueContent).toBe('my result')
    expect(result.returnValueResult).toBe('completed')
  })
})
