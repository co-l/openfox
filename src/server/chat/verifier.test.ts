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
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: getAllInstructionsMock,
}))

vi.mock('../context/tokenizer.js', () => ({
  estimateTokens: estimateTokensMock,
}))

vi.mock('./tool-streaming.js', () => ({
  createToolProgressHandler: createToolProgressHandlerMock,
}))

import { runVerifierStep } from './verifier.js'

describe('runVerifierStep', () => {
  beforeEach(() => {
    streamLLMResponseMock.mockReset()
    getToolRegistryForModeMock.mockReset()
    getAllInstructionsMock.mockReset()
    estimateTokensMock.mockClear()
    createToolProgressHandlerMock.mockClear()
  })

  it('returns early when there is nothing to verify', async () => {
    const sessionManager = {
      requireSession: vi.fn(() => ({ criteria: [] })),
    }

    const result = await runVerifierStep({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: () => {},
    })

    expect(result).toEqual({
      messageId: '',
      hasToolCalls: false,
      content: '',
      timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
      usage: { promptTokens: 0, completionTokens: 0 },
      toolTime: 0,
      allPassed: true,
      failed: [],
    })
  })

  it('uses fresh context, executes verifier tools, and reports failed criteria', async () => {
    const sessionState: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      summary: 'Implemented feature',
      criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }],
      executionState: { modifiedFiles: ['src/index.ts'] },
    }

    const toolRegistry = {
      definitions: [{ type: 'function', function: { name: 'fail_criterion', description: 'Fail', parameters: { type: 'object' } } }],
      execute: vi.fn(async () => {
        sessionState.criteria = [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'failed', failedAt: '2024-01-01T00:00:00.000Z', reason: 'still broken' }, attempts: [] }]
        return { success: true, output: 'failed criterion', durationMs: 30, truncated: false }
      }),
    }

    getToolRegistryForModeMock.mockReturnValue(toolRegistry)
    getAllInstructionsMock.mockResolvedValue({
      content: 'Verify carefully',
      files: [{ path: 'AGENTS.md', content: 'Verify carefully', source: 'global' }],
    })
    streamLLMResponseMock
      .mockResolvedValueOnce({
        messageId: 'verifier-1',
        content: 'Checking',
        toolCalls: [{ id: 'call-1', name: 'fail_criterion', arguments: { id: 'tests-pass', reason: 'still broken' } }],
        usage: { promptTokens: 12, completionTokens: 4 },
        timing: { ttft: 1, completionTime: 1, tps: 4, prefillTps: 12 },
      })
      .mockResolvedValueOnce({
        messageId: 'verifier-2',
        content: 'Finished',
        toolCalls: [],
        usage: { promptTokens: 8, completionTokens: 2 },
        timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 8 },
      })

    const addedMessages: Array<Record<string, unknown>> = []
    const emitted = [] as Array<{ type: string; payload: Record<string, unknown> }>
    const sessionManager = {
      requireSession: vi.fn(() => structuredClone(sessionState)),
      addMessage: vi.fn((_sessionId, message) => {
        const saved = { id: `saved-${addedMessages.length + 1}`, timestamp: '2024-01-01T00:00:00.000Z', ...message }
        addedMessages.push(saved)
        return saved
      }),
      updateMessage: vi.fn(),
      updateMessageStats: vi.fn(),
      getLspManager: vi.fn(() => ({ name: 'lsp' })),
    }

    const result = await runVerifierStep({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: (message) => {
        emitted.push(message as never)
      },
    })

    expect(addedMessages).toHaveLength(3)
    expect(addedMessages[0]).toMatchObject({ messageKind: 'context-reset', subAgentType: 'verifier' })
    expect(addedMessages[1]?.['content']).toContain('## Task Summary')
    expect(addedMessages[2]).toMatchObject({ messageKind: 'auto-prompt', subAgentType: 'verifier' })
    expect(sessionManager.updateMessage).toHaveBeenCalledWith('session-1', 'saved-3', {
      promptContext: {
        systemPrompt: expect.any(String),
        injectedFiles: [{ path: 'AGENTS.md', content: 'Verify carefully', source: 'global' }],
        userMessage: expect.any(String),
        messages: expect.any(Array),
        tools: expect.any(Array),
        requestOptions: { toolChoice: 'auto', disableThinking: true },
      },
    })
    expect(toolRegistry.execute).toHaveBeenCalledWith('fail_criterion', { id: 'tests-pass', reason: 'still broken' }, expect.objectContaining({
      workdir: '/tmp/project',
      sessionId: 'session-1',
    }))
    expect(emitted.map((message) => message.type)).toContain('chat.tool_call')
    expect(emitted.map((message) => message.type)).toContain('chat.tool_result')
    expect(emitted.map((message) => message.type)).toContain('criteria.updated')
    expect(emitted.at(-1)).toMatchObject({ type: 'chat.done', payload: { messageId: 'verifier-2', reason: 'complete' } })
    expect(sessionManager.updateMessageStats).toHaveBeenCalledWith('session-1', 'verifier-2', expect.objectContaining({
      model: 'qwen3-32b',
      mode: 'verifier',
      prefillTokens: 20,
      generationTokens: 6,
      toolTime: 0.03,
    }))
    expect(result).toEqual({
      messageId: 'verifier-2',
      hasToolCalls: false,
      content: '',
      timing: { ttft: 2, completionTime: 2, tps: 3, prefillTps: 10 },
      usage: { promptTokens: 20, completionTokens: 6 },
      toolTime: 30,
      allPassed: false,
      failed: [{ id: 'tests-pass', reason: 'still broken' }],
    })
  })
})
