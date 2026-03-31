import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  streamLLMResponseMock,
  getToolRegistryForModeMock,
  getAllInstructionsMock,
  estimateTokensMock,
  createToolProgressHandlerMock,
} = vi.hoisted(() => ({
  streamLLMResponseMock: vi.fn(),
  getToolRegistryForModeMock: vi.fn(),
  getAllInstructionsMock: vi.fn(),
  estimateTokensMock: vi.fn((content: string) => content.length),
  createToolProgressHandlerMock: vi.fn(() => undefined),
}))

vi.mock('./stream.js', () => ({
  streamLLMResponse: streamLLMResponseMock,
}))

vi.mock('../tools/index.js', () => ({
  getToolRegistryForMode: getToolRegistryForModeMock,
  getToolRegistryForAgent: (...args: unknown[]) => getToolRegistryForModeMock(...args),
}))

vi.mock('../agents/registry.js', () => {
  const agents = [
    {
      metadata: { id: 'builder', name: 'Builder', description: 'Builds', subagent: false, tools: ['read_file', 'write_file', 'edit_file', 'run_command'] },
      prompt: '# Build Mode\nBuild mode ACTIVE.',
    },
    {
      metadata: { id: 'verifier', name: 'Verifier', description: 'Verifies', subagent: true, tools: ['read_file'] },
      prompt: 'Verify.',
    },
  ]
  return {
    loadAllAgentsDefault: vi.fn(async () => agents),
    findAgentById: vi.fn((id: string, list: any[]) => list.find((a: any) => a.metadata.id === id)),
    getSubAgents: vi.fn((list: any[]) => list.filter((a: any) => a.metadata.subagent)),
  }
})

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: getAllInstructionsMock,
}))

vi.mock('../context/tokenizer.js', () => ({
  estimateTokens: estimateTokensMock,
}))

vi.mock('./tool-streaming.js', () => ({
  createToolProgressHandler: createToolProgressHandlerMock,
}))

import { runBuilderStep } from './builder.js'

describe('runBuilderStep', () => {
  beforeEach(() => {
    streamLLMResponseMock.mockReset()
    getToolRegistryForModeMock.mockReset()
    getAllInstructionsMock.mockReset()
    estimateTokensMock.mockClear()
    createToolProgressHandlerMock.mockClear()
  })

  it('runs the builder loop, records tool results, and completes with aggregated stats', async () => {
    const sessionState: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
      messages: [{ id: 'user-1', role: 'user', content: 'Build it' }],
      executionState: { modifiedFiles: [] },
    }

    const toolRegistry = {
      definitions: [{ type: 'function', function: { name: 'write_file', description: 'Write', parameters: { type: 'object' } } }],
      execute: vi.fn(async () => {
        sessionState.criteria = [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }]
        return { success: true, output: 'written', durationMs: 25, truncated: false }
      }),
    }

    getToolRegistryForModeMock.mockReturnValue(toolRegistry)
    getAllInstructionsMock.mockResolvedValue({
      content: 'Always add tests',
      files: [{ path: 'AGENTS.md', content: 'Always add tests', source: 'global' }],
    })
    streamLLMResponseMock
      .mockResolvedValueOnce({
        messageId: 'assistant-1',
        content: 'Working',
        toolCalls: [{ id: 'call-1', name: 'write_file', arguments: { path: 'src/index.ts' } }],
        usage: { promptTokens: 20, completionTokens: 5 },
        timing: { ttft: 1, completionTime: 2, tps: 2.5, prefillTps: 20 },
      })
      .mockResolvedValueOnce({
        messageId: 'assistant-2',
        content: 'Done',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 3 },
        timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 10 },
      })

    const addedMessages: Array<Record<string, unknown>> = []
    const emitted = [] as Array<{ type: string; payload: Record<string, unknown> }>
    const sessionManager = {
      requireSession: vi.fn(() => structuredClone(sessionState)),
      addMessage: vi.fn((_sessionId, message) => {
        const saved = { id: `saved-${addedMessages.length + 1}`, timestamp: '2024-01-01T00:00:00.000Z', ...message }
        addedMessages.push(saved)
        sessionState.messages = [...sessionState.messages, saved]
        return saved
      }),
      getCurrentWindowMessages: vi.fn(() => structuredClone(sessionState.messages)),
      updateMessage: vi.fn(),
      updateMessageStats: vi.fn(),
      addModifiedFile: vi.fn((_, path) => {
        sessionState.executionState = { modifiedFiles: [path] }
      }),
      getLspManager: vi.fn(() => ({ name: 'lsp' })),
    }

    const result = await runBuilderStep({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: (message) => {
        emitted.push(message as never)
      },
    })

    expect(addedMessages[0]).toMatchObject({
      role: 'user',
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
    })
    expect(sessionManager.updateMessage).toHaveBeenCalledWith('session-1', 'saved-1', {
      promptContext: {
        systemPrompt: expect.any(String),
        injectedFiles: [{ path: 'AGENTS.md', content: 'Always add tests', source: 'global' }],
        userMessage: 'Build it',
        messages: [
          { role: 'user', content: 'Build it', source: 'history' },
          { role: 'user', content: expect.stringContaining('fulfil the 1 criteria'), source: 'runtime' },
        ],
        tools: expect.any(Array),
        requestOptions: { toolChoice: 'auto', disableThinking: false },
      },
    })
    expect(toolRegistry.execute).toHaveBeenCalledWith('write_file', { path: 'src/index.ts' }, expect.objectContaining({
      workdir: '/tmp/project',
      sessionId: 'session-1',
    }))
    expect(sessionManager.addModifiedFile).toHaveBeenCalledWith('session-1', 'src/index.ts')
    expect(sessionManager.updateMessageStats).toHaveBeenCalledWith('session-1', 'assistant-2', expect.objectContaining({
      model: 'qwen3-32b',
      mode: 'builder',
      prefillTokens: 30,
      generationTokens: 8,
      toolTime: 0.025,
    }))
    expect(emitted.map((message) => message.type)).toContain('chat.tool_call')
    expect(emitted.map((message) => message.type)).toContain('chat.tool_result')
    expect(emitted.map((message) => message.type)).toContain('chat.message')
    expect(emitted.map((message) => message.type)).toContain('criteria.updated')
    expect(emitted.at(-1)).toMatchObject({ type: 'chat.done', payload: { messageId: 'assistant-2', reason: 'complete' } })
    expect(result).toEqual({
      messageId: 'assistant-2',
      hasToolCalls: true,
      content: 'Done',
      timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 10 },
      usage: { promptTokens: 30, completionTokens: 8 },
      toolTime: 25,
    })
  })

  it('returns partial stats and throws when aborted mid-loop', async () => {
    const controller = new AbortController()
    controller.abort()
    getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })

    const sessionManager = {
      requireSession: vi.fn(() => ({
        projectId: 'project-1',
        workdir: '/tmp/project',
        criteria: [],
        messages: [{ id: 'assistant-1', role: 'assistant', content: 'ongoing' }],
        executionState: { modifiedFiles: [] },
      })),
      addMessage: vi.fn(),
      getCurrentWindowMessages: vi.fn(() => []),
      updateMessage: vi.fn(),
      updateMessageStats: vi.fn(),
      addModifiedFile: vi.fn(),
      getLspManager: vi.fn(() => ({ name: 'lsp' })),
    }

    await expect(runBuilderStep({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      signal: controller.signal,
      onMessage: () => {},
    })).rejects.toThrow('Aborted')
  })
})
