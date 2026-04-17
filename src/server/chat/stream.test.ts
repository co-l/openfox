import { beforeEach, describe, expect, it, vi } from 'vitest'

const { streamWithSegmentsMock } = vi.hoisted(() => ({
  streamWithSegmentsMock: vi.fn(),
}))

vi.mock('../llm/streaming.js', () => ({
  streamWithSegments: streamWithSegmentsMock,
}))

import { streamLLMResponse } from './stream.js'

function createStream(events: Array<Record<string, unknown>>, result: Record<string, unknown> | null) {
  return (async function* () {
    for (const event of events) {
      yield event
    }
    return result
  })()
}

function createSessionManager() {
  let nextId = 1

  return {
    addMessage: vi.fn((_sessionId, message) => ({
      id: `msg-${nextId++}`,
      timestamp: '2024-01-01T00:00:00.000Z',
      ...message,
    })),
    addAssistantMessage: vi.fn((_sessionId, message) => ({
      id: `msg-${nextId++}`,
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      content: message.content ?? '',
      isStreaming: true,
      ...message,
    })),
    getCurrentWindowMessages: vi.fn(() => [{ role: 'user', content: 'hello' }]),
    updateMessage: vi.fn(),
    setCurrentContextSize: vi.fn(),
    addTokensUsed: vi.fn(),
  }
}

describe('streamLLMResponse', () => {
  beforeEach(() => {
    streamWithSegmentsMock.mockReset()
  })

  it('creates an assistant message, forwards streaming events, and persists the final result', async () => {
    streamWithSegmentsMock.mockReturnValueOnce(createStream([
      { type: 'thinking_delta', content: 'thinking' },
      { type: 'text_delta', content: 'answer' },
      { type: 'tool_call_delta', index: 0, name: 'read_file' },
    ], {
      content: 'answer',
      thinkingContent: 'thinking',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
      response: {
        usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
      },
      segments: [{ type: 'text', content: 'answer' }],
      timing: { ttft: 1, completionTime: 2, tps: 2, prefillTps: 10 },
    }))

    const sessionManager = createSessionManager()
    const emitted = [] as Array<{ type: string; payload: Record<string, unknown> }>

    const result = await streamLLMResponse({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      systemPrompt: 'system prompt',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      tools: [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object' } } }],
      toolChoice: 'auto',
      onEvent: (event) => {
        emitted.push(event as never)
      },
    })

    expect(streamWithSegmentsMock).toHaveBeenCalledWith(expect.anything(), {
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'hello' },
      ],
      tools: [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object' } } }],
      toolChoice: 'auto',
      disableThinking: false,
    })
    expect(emitted.map((event) => event.type)).toEqual([
      'chat.message',
      'chat.thinking',
      'chat.delta',
      'chat.tool_preparing',
    ])
    expect(sessionManager.updateMessage).toHaveBeenCalledWith('session-1', 'msg-1', {
      content: 'answer',
      thinkingContent: 'thinking',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
      segments: [{ type: 'text', content: 'answer' }],
      isStreaming: false,
    })
    expect(sessionManager.setCurrentContextSize).toHaveBeenCalledWith('session-1', 10)
    expect(sessionManager.addTokensUsed).toHaveBeenCalledWith('session-1', 14)
    expect(result).toEqual({
      messageId: 'msg-1',
      content: 'answer',
      thinkingContent: 'thinking',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
      segments: [{ type: 'text', content: 'answer' }],
      usage: { promptTokens: 10, completionTokens: 4 },
      timing: { ttft: 1, completionTime: 2, tps: 2, prefillTps: 10 },
    })
  })

  it('injects a correction prompt and retries when xml tool output is detected', async () => {
    streamWithSegmentsMock
      .mockReturnValueOnce(createStream([{ type: 'xml_tool_abort' }], null))
      .mockReturnValueOnce(createStream([], {
        content: 'fixed',
        toolCalls: [],
        response: {
          usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
        },
        segments: [],
        timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 8 },
      }))

    const sessionManager = createSessionManager()
    const emitted = [] as Array<{ type: string; payload: Record<string, unknown> }>

    const result = await streamLLMResponse({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      systemPrompt: 'system prompt',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onEvent: (event) => {
        emitted.push(event as never)
      },
    })

    expect(sessionManager.addAssistantMessage).toHaveBeenCalledTimes(1)
    expect(sessionManager.addMessage).toHaveBeenCalledTimes(1)
    expect(sessionManager.addMessage).toHaveBeenCalledWith('session-1', expect.objectContaining({
      role: 'user',
      isSystemGenerated: true,
      messageKind: 'correction',
    }))
    expect(emitted.map((event) => event.type)).toEqual([
      'chat.message',
    ])
    expect(result.messageId).toBe('msg-1')
    expect(streamWithSegmentsMock).toHaveBeenCalledTimes(2)
  })

  it('marks the message partial and throws when aborted', async () => {
    streamWithSegmentsMock.mockReturnValueOnce(createStream([], {
      content: 'unused',
      toolCalls: [],
      response: { usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
      segments: [],
      timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 1 },
    }))

    const controller = new AbortController()
    controller.abort()
    const sessionManager = createSessionManager()

    await expect(streamLLMResponse({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      systemPrompt: 'system prompt',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      signal: controller.signal,
      onEvent: () => {},
    })).rejects.toThrow('Aborted')

    expect(sessionManager.updateMessage).toHaveBeenCalledWith('session-1', 'msg-1', { isStreaming: false, partial: true })
  })

  it('emits an error completion when the stream ends without a result', async () => {
    streamWithSegmentsMock.mockReturnValueOnce(createStream([], null))

    const sessionManager = createSessionManager()
    const emitted = [] as Array<{ type: string; payload: Record<string, unknown> }>

    await expect(streamLLMResponse({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      systemPrompt: 'system prompt',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onEvent: (event) => {
        emitted.push(event as never)
      },
    })).rejects.toThrow('LLM stream returned no result')

    expect(sessionManager.updateMessage).toHaveBeenCalledWith('session-1', 'msg-1', { isStreaming: false })
    expect(emitted.map((event) => event.type)).toEqual(['chat.message', 'chat.done'])
    expect(emitted[1]?.payload).toEqual({ messageId: 'msg-1', reason: 'error' })
  })
})
