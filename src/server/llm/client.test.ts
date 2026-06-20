import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openAiCreateMock, openAiCtorArgs } = vi.hoisted(() => ({
  openAiCreateMock: vi.fn(),
  openAiCtorArgs: [] as Array<Record<string, unknown>>,
}))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: openAiCreateMock,
      },
    }

    constructor(args: Record<string, unknown>) {
      openAiCtorArgs.push(args)
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
    openAiCtorArgs.length = 0
    openAiCreateMock.mockReset()
  })

  it('normalizes the base url and maps complete responses with reasoning and tool calls', async () => {
    openAiCreateMock.mockResolvedValueOnce({
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

    expect(openAiCtorArgs[0]).toMatchObject({
      baseURL: 'http://localhost:8000/v1',
      apiKey: 'not-needed',
    })
    expect(openAiCtorArgs[0]).not.toHaveProperty('timeout')
    expect(openAiCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen3-32b',
        stream: false,
        top_p: 0.9,
        messages: [{ role: 'user', content: 'hello' }],
      }),
      { signal: undefined },
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
    openAiCreateMock.mockResolvedValueOnce({
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
    openAiCreateMock.mockRejectedValueOnce(new Error('network down'))

    const client = createLLMClient(createConfig(), 'vllm')

    await expect(client.complete({ messages: [{ role: 'user', content: 'hello' }] })).rejects.toMatchObject({
      name: 'LLMError',
      message: 'network down',
    })
  })

  it('updates model/backend getters and extracts reasoning from response', async () => {
    openAiCreateMock.mockResolvedValueOnce({
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
    openAiCreateMock.mockResolvedValueOnce({ id: 'resp-4', choices: [], usage: undefined })

    const client = createLLMClient(createConfig(), 'vllm')

    await expect(client.complete({ messages: [{ role: 'user', content: 'hello' }] })).rejects.toMatchObject({
      name: 'LLMError',
      message: 'No completion choice returned',
    })
  })

  it('streams reasoning, text, and tool calls and emits a done event with parsed tool calls', async () => {
    openAiCreateMock.mockResolvedValueOnce(
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
      reasoningEffort: 'none',
    })) {
      events.push(event as Record<string, unknown>)
    }

    expect(openAiCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        reasoning_effort: 'none',
        chat_template_kwargs: { enable_thinking: false },
      }),
      { signal: undefined },
    )
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
    openAiCreateMock.mockResolvedValueOnce(
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
    openAiCreateMock.mockResolvedValueOnce(
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
    openAiCreateMock.mockRejectedValueOnce(new Error('stream failed'))

    const client = createLLMClient(createConfig(), 'vllm')
    const events = [] as Array<Record<string, unknown>>

    for await (const event of client.stream({ messages: [{ role: 'user', content: 'hello' }] })) {
      events.push(event as Record<string, unknown>)
    }

    expect(events).toEqual([{ type: 'error', error: 'stream failed' }])
  })

  it('includes tool calls with parseError when JSON arguments are malformed', async () => {
    openAiCreateMock.mockResolvedValueOnce(
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
    openAiCreateMock.mockResolvedValueOnce({
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

    expect(openAiCtorArgs[0]).not.toHaveProperty('timeout')
    expect(openAiCtorArgs[0]).toMatchObject({
      baseURL: 'http://localhost:8000/v1',
      apiKey: 'not-needed',
    })
  })

  it('triggers idle timeout when no chunks arrive for the configured duration', async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    openAiCreateMock.mockResolvedValueOnce(
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

  it('allows active streams to continue beyond the idle timeout when chunks arrive frequently', async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    openAiCreateMock.mockResolvedValueOnce(
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
