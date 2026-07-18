import { beforeEach, describe, expect, it, vi } from 'vitest'

const { httpClientCreateMock, httpClientCreateStreamMock, httpClientCtorArgs } = vi.hoisted(() => ({
  httpClientCreateMock: vi.fn(),
  httpClientCreateStreamMock: vi.fn(),
  httpClientCtorArgs: [] as Array<Record<string, unknown>>,
}))

vi.mock('./http-client.js', () => ({
  OpenAIHttpClient: class MockOpenAIHttpClient {
    createChatCompletion = httpClientCreateMock
    createChatCompletionStream = httpClientCreateStreamMock

    constructor(args: Record<string, unknown>) {
      httpClientCtorArgs.push(args)
    }
  },
}))

import { createLLMClient } from './client.js'

function createConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    llm: {
      baseUrl: 'http://localhost:8000',
      timeout: 12_000,
      model: 'qwen3-32b',
      ...overrides,
    },
  } as never
}

function createChunk(chunk: Record<string, unknown>) {
  return {
    id: 'resp-1',
    choices: [],
    ...chunk,
  }
}

describe('llm client', () => {
  beforeEach(() => {
    httpClientCtorArgs.length = 0
    httpClientCreateMock.mockReset()
    httpClientCreateStreamMock.mockReset()
  })

  it('normalizes the base url and maps complete responses with reasoning and tool calls', async () => {
    httpClientCreateMock.mockResolvedValueOnce({
      id: 'resp-1',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'Final answer',
            reasoning_content: 'Reasoning here',
            tool_calls: [
              {
                id: 'call-1',
                function: { name: 'glob', arguments: '{"pattern":"*.ts"}' },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    })

    const client = createLLMClient(createConfig(), 'vllm')
    const response = await client.complete({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ type: 'function', function: { name: 'glob', description: 'Search', parameters: { type: 'object' } } }],
      toolChoice: 'auto',
    })

    expect(httpClientCtorArgs[0]).toMatchObject({
      baseURL: 'http://localhost:8000/v1',
      apiKey: 'not-needed',
    })
    expect(httpClientCtorArgs[0]).not.toHaveProperty('timeout')
    expect(httpClientCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen3-32b',
        stream: false,
        top_p: 0.9,
        messages: [{ role: 'user', content: 'hello' }],
      }),
      { signal: undefined },
      undefined,
    )
    expect(response).toEqual({
      id: 'resp-1',
      content: 'Final answer',
      thinkingContent: 'Reasoning here',
      toolCalls: [{ id: 'call-1', name: 'glob', arguments: { pattern: '*.ts' } }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
  })

  it('extracts reasoning_content field from response', async () => {
    httpClientCreateMock.mockResolvedValueOnce({
      id: 'resp-2',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: 'Final answer',
            reasoning_content: 'My reasoning process',
          },
        },
      ],
      usage: {
        prompt_tokens: 4,
        completion_tokens: 2,
        total_tokens: 6,
      },
    })

    const client = createLLMClient(createConfig(), 'vllm')
    const response = await client.complete({
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(response).toEqual({
      id: 'resp-2',
      content: 'Final answer',
      thinkingContent: 'My reasoning process',
      finishReason: 'stop',
      usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    })
  })

  it('wraps completion failures in LLMError', async () => {
    httpClientCreateMock.mockRejectedValueOnce(new Error('network down'))

    const client = createLLMClient(createConfig(), 'vllm')

    await expect(client.complete({ messages: [{ role: 'user', content: 'hello' }] })).rejects.toMatchObject({
      name: 'LLMError',
      message: 'network down',
    })
  })

  it('updates model/backend getters and extracts reasoning from response', async () => {
    httpClientCreateMock.mockResolvedValueOnce({
      id: 'resp-3',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: 'Final content',
            reasoning_content: 'reasoning process',
          },
        },
      ],
      usage: {
        prompt_tokens: 6,
        completion_tokens: 2,
        total_tokens: 8,
      },
    })

    const client = createLLMClient(createConfig(), 'vllm')
    expect(client.getModel()).toBe('qwen3-32b')
    expect(client.getBackend()).toBe('vllm')
    client.setModel('mistral-7b')
    client.setBackend('ollama')
    expect(client.getModel()).toBe('mistral-7b')
    expect(client.getBackend()).toBe('ollama')

    client.setModel('qwen3-32b')
    client.setBackend('vllm')
    const response = await client.complete({ messages: [{ role: 'user', content: 'hello' }] })

    expect(response).toEqual({
      id: 'resp-3',
      content: 'Final content',
      thinkingContent: 'reasoning process',
      finishReason: 'stop',
      usage: { promptTokens: 6, completionTokens: 2, totalTokens: 8 },
    })
  })

  it('throws when no completion choice is returned', async () => {
    httpClientCreateMock.mockResolvedValueOnce({ id: 'resp-4', choices: [], usage: undefined })

    const client = createLLMClient(createConfig(), 'vllm')

    await expect(client.complete({ messages: [{ role: 'user', content: 'hello' }] })).rejects.toMatchObject({
      name: 'LLMError',
      message: 'No completion choice returned',
    })
  })

  it('handles tool calls with empty arguments string', async () => {
    httpClientCreateStreamMock.mockReturnValueOnce(
      (async function* () {
        yield createChunk({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'call-1', function: { name: 'step_done', arguments: '' } }],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      })(),
    )

    const client = createLLMClient(createConfig(), 'vllm')
    const events = [] as Array<Record<string, unknown>>

    for await (const event of client.stream({
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      events.push(event as Record<string, unknown>)
    }

    const doneEvent = events.find((e) => e['type'] === 'done') as Record<string, unknown> | undefined
    const response = doneEvent?.['response'] as Record<string, unknown> | undefined
    const toolCalls = response?.['toolCalls'] as Array<Record<string, unknown>> | undefined

    expect(toolCalls).toHaveLength(1)
    expect(toolCalls?.[0]).toMatchObject({
      id: 'call-1',
      name: 'step_done',
      arguments: {},
    })
    expect(toolCalls?.[0]).not.toHaveProperty('parseError')
  })

  it('handles tool calls with empty arguments string in complete path', async () => {
    httpClientCreateMock.mockResolvedValueOnce({
      id: 'resp-1',
      choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'step_done', arguments: '' } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })

    const client = createLLMClient(createConfig(), 'vllm')
    const result = await client.complete({
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls?.[0]).toMatchObject({
      id: 'call-1',
      name: 'step_done',
      arguments: {},
    })
  })

  it('streams reasoning, text, and tool calls and emits a done event with parsed tool calls', async () => {
    httpClientCreateStreamMock.mockReturnValueOnce(
      (async function* () {
        yield createChunk({
          choices: [
            {
              delta: { reasoning_content: 'think ' },
              finish_reason: null,
            },
          ],
        })
        yield createChunk({
          choices: [
            {
              delta: { content: 'answer ' },
              finish_reason: null,
            },
          ],
        })
        yield createChunk({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'call-1', function: { name: 'glob', arguments: '{"pattern":"*.ts"}' } }],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 6,
            total_tokens: 17,
          },
        })
      })(),
    )

    const client = createLLMClient(createConfig(), 'vllm')
    const events = [] as Array<Record<string, unknown>>

    for await (const event of client.stream({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ type: 'function', function: { name: 'glob', description: 'Search', parameters: { type: 'object' } } }],
      modelSettings: { chatTemplateKwargs: { enable_thinking: false } },
    })) {
      events.push(event as Record<string, unknown>)
    }

    expect(httpClientCreateStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        chat_template_kwargs: { enable_thinking: false },
      }),
      { signal: undefined },
    )
    // Should NOT have reasoning_effort in the params
    const callArgs = httpClientCreateStreamMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(callArgs).not.toHaveProperty('reasoning_effort')
    expect(events).toEqual([
      { type: 'thinking_delta', content: 'think ' },
      { type: 'text_delta', content: 'answer ' },
      { type: 'tool_call_delta', index: 0, id: 'call-1', name: 'glob', arguments: '{"pattern":"*.ts"}' },
      {
        type: 'done',
        response: {
          id: 'resp-1',
          content: 'answer',
          thinkingContent: 'think',
          toolCalls: [{ id: 'call-1', name: 'glob', arguments: { pattern: '*.ts' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 11, completionTokens: 6, totalTokens: 17 },
        },
      },
    ])
  })

  it('streams reasoning_content as thinking_delta', async () => {
    httpClientCreateStreamMock.mockReturnValueOnce(
      (async function* () {
        yield createChunk({
          choices: [
            {
              delta: { reasoning_content: 'step by step ' },
              finish_reason: null,
            },
          ],
        })
        yield createChunk({
          choices: [
            {
              delta: { content: 'final answer' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 3,
            completion_tokens: 2,
            total_tokens: 5,
          },
        })
      })(),
    )

    const client = createLLMClient(createConfig(), 'vllm')
    const events = [] as Array<Record<string, unknown>>

    for await (const event of client.stream({ messages: [{ role: 'user', content: 'hello' }] })) {
      events.push(event as Record<string, unknown>)
    }

    expect(events).toEqual([
      { type: 'thinking_delta', content: 'step by step ' },
      { type: 'text_delta', content: 'final answer' },
      {
        type: 'done',
        response: {
          id: 'resp-1',
          content: 'final answer',
          thinkingContent: 'step by step',
          finishReason: 'stop',
          usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
        },
      },
    ])
  })

  it('treats reasoning field as thinking_delta and includes tool calls with parseError for invalid tool args', async () => {
    httpClientCreateStreamMock.mockReturnValueOnce(
      (async function* () {
        yield createChunk({
          choices: [
            {
              delta: { reasoning_content: 'reasoning process ' },
              finish_reason: null,
            },
          ],
        })
        yield createChunk({
          choices: [
            {
              delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'glob', arguments: '{bad-json' } }] },
              finish_reason: 'tool_calls',
            },
          ],
          usage: {
            prompt_tokens: 9,
            completion_tokens: 3,
            total_tokens: 12,
          },
        })
      })(),
    )

    const client = createLLMClient(createConfig({ model: 'mistral-7b' }), 'vllm')
    const events = [] as Array<Record<string, unknown>>

    for await (const event of client.stream({ messages: [{ role: 'user', content: 'hello' }] })) {
      events.push(event as Record<string, unknown>)
    }

    expect(events).toEqual([
      { type: 'thinking_delta', content: 'reasoning process ' },
      { type: 'tool_call_delta', index: 0, id: 'call-1', name: 'glob', arguments: '{bad-json' },
      {
        type: 'done',
        response: {
          id: 'resp-1',
          content: '',
          thinkingContent: 'reasoning process',
          finishReason: 'tool_calls',
          usage: { promptTokens: 9, completionTokens: 3, totalTokens: 12 },
          toolCalls: [
            {
              id: 'call-1',
              name: 'glob',
              arguments: {},
              parseError: expect.stringContaining('JSON'),
              rawArguments: '{bad-json',
            },
          ],
        },
      },
    ])
  })

  it('yields error events when streaming fails', async () => {
    httpClientCreateStreamMock.mockImplementationOnce(() => {
      throw new Error('stream failed')
    })

    const client = createLLMClient(createConfig(), 'vllm')
    const events = [] as Array<Record<string, unknown>>

    for await (const event of client.stream({ messages: [{ role: 'user', content: 'hello' }] })) {
      events.push(event as Record<string, unknown>)
    }

    expect(events).toEqual([{ type: 'error', error: 'stream failed' }])
  })

  it('surfaces error chunks that do not contain choices', async () => {
    httpClientCreateStreamMock.mockReturnValueOnce(
      (async function* () {
        yield { error: { message: 'Invalid tool schema' } } as never
      })(),
    )

    const client = createLLMClient(createConfig(), 'vllm')
    const events = [] as Array<Record<string, unknown>>

    for await (const event of client.stream({ messages: [{ role: 'user', content: 'hello' }] })) {
      events.push(event as Record<string, unknown>)
    }

    expect(events).toEqual([{ type: 'error', error: 'Invalid tool schema' }])
  })

  it('includes tool calls with parseError when JSON arguments are malformed', async () => {
    httpClientCreateStreamMock.mockReturnValueOnce(
      (async function* () {
        yield createChunk({
          choices: [
            {
              delta: { content: 'Let me search for files' },
              finish_reason: null,
            },
          ],
        })
        yield createChunk({
          choices: [
            {
              delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'glob', arguments: '{bad-json' } }] },
              finish_reason: 'tool_calls',
            },
          ],
          usage: {
            prompt_tokens: 9,
            completion_tokens: 3,
            total_tokens: 12,
          },
        })
      })(),
    )

    const client = createLLMClient(createConfig(), 'vllm')
    const events = [] as Array<Record<string, unknown>>

    for await (const event of client.stream({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ type: 'function', function: { name: 'glob', description: 'Search', parameters: { type: 'object' } } }],
    })) {
      events.push(event as Record<string, unknown>)
    }

    const doneEvent = events.find(
      (event): event is Record<string, unknown> & { response: Record<string, unknown> } =>
        event['type'] === 'done' && 'response' in event,
    )
    expect(doneEvent).toBeDefined()
    if (!doneEvent) {
      throw new Error('Expected done event')
    }
    const response = doneEvent.response
    const toolCalls = response['toolCalls'] as Array<Record<string, unknown>> | undefined
    expect(toolCalls).toHaveLength(1)
    const toolCall = toolCalls?.[0]
    expect(toolCall).toEqual({
      id: 'call-1',
      name: 'glob',
      arguments: {},
      parseError: expect.stringContaining('JSON'),
      rawArguments: '{bad-json',
    })
  })

  it('does not include timeout in OpenAI client constructor when idleTimeout is configured', async () => {
    httpClientCreateMock.mockResolvedValueOnce({
      id: 'resp-1',
      choices: [
        {
          finish_reason: 'stop',
          message: { content: 'test' },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })

    const client = createLLMClient(createConfig({ idleTimeout: 30_000 }), 'vllm')
    await client.complete({ messages: [{ role: 'user', content: 'hello' }] })

    expect(httpClientCtorArgs[0]).not.toHaveProperty('timeout')
    expect(httpClientCtorArgs[0]).toMatchObject({
      baseURL: 'http://localhost:8000/v1',
      apiKey: 'not-needed',
    })
  })

  it('triggers idle timeout when no chunks arrive for the configured duration', async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    httpClientCreateStreamMock.mockReturnValueOnce(
      (async function* () {
        yield createChunk({
          choices: [{ delta: { content: 'first chunk' }, finish_reason: null }],
        })
        await delay(50)
        yield createChunk({
          choices: [{ delta: { content: 'second chunk' }, finish_reason: null }],
        })
        await delay(500) // Long enough to trigger idle timeout
        yield createChunk({
          choices: [{ delta: { content: 'third chunk' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
        })
      })(),
    )

    const client = createLLMClient(createConfig({ idleTimeout: 150 }), 'vllm')
    const events = [] as Array<Record<string, unknown>>

    for await (const event of client.stream({ messages: [{ role: 'user', content: 'hello' }] })) {
      events.push(event as Record<string, unknown>)
    }

    expect(events).toEqual([
      { type: 'text_delta', content: 'first chunk' },
      { type: 'text_delta', content: 'second chunk' },
      { type: 'error', error: expect.stringContaining('idle timeout') },
    ])
  })

  it('streams reasoning_content when reasoningEffort is set', async () => {
    httpClientCreateStreamMock.mockReturnValueOnce(
      (async function* () {
        yield createChunk({
          choices: [{ delta: { reasoning_content: 'step by step ' }, finish_reason: null }],
        })
        yield createChunk({
          choices: [{ delta: { content: 'final answer' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        })
      })(),
    )

    const client = createLLMClient(createConfig(), 'vllm')
    const events = [] as Array<Record<string, unknown>>

    for await (const event of client.stream({
      messages: [{ role: 'user', content: 'think hard' }],
      reasoningEffort: 'high',
    })) {
      events.push(event as Record<string, unknown>)
    }

    // Should use streaming (not non-streaming fallback)
    const callArgs = httpClientCreateStreamMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(callArgs).toHaveProperty('stream', true)
    expect(callArgs).toHaveProperty('reasoning_effort', 'high')
    expect(callArgs).toHaveProperty('model', 'qwen3-32b')

    expect(events).toEqual([
      { type: 'thinking_delta', content: 'step by step ' },
      { type: 'text_delta', content: 'final answer' },
      {
        type: 'done',
        response: {
          id: 'resp-1',
          content: 'final answer',
          thinkingContent: 'step by step',
          finishReason: 'stop',
          usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
        },
      },
    ])
  })

  it('allows active streams to continue beyond the idle timeout when chunks arrive frequently', async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    httpClientCreateStreamMock.mockReturnValueOnce(
      (async function* () {
        for (let i = 0; i < 10; i++) {
          yield createChunk({
            choices: [{ delta: { content: `chunk ${i} ` }, finish_reason: i === 9 ? 'stop' : null }],
          })
          await delay(50)
        }
        yield createChunk({
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        })
      })(),
    )

    const client = createLLMClient(createConfig({ idleTimeout: 100 }), 'vllm')
    const events = [] as Array<Record<string, unknown>>

    for await (const event of client.stream({ messages: [{ role: 'user', content: 'hello' }] })) {
      events.push(event as Record<string, unknown>)
    }

    expect(events.filter((e) => e['type'] === 'text_delta')).toHaveLength(10)
    expect(events.find((e) => e['type'] === 'done')).toBeDefined()
    expect(events.find((e) => e['type'] === 'error')).toBeUndefined()
  })
})
