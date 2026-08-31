import { describe, expect, it } from 'vitest'
import { buildOllamaChatRequest, parseOllamaChatResponse, parseOllamaChatChunk } from './ollama-native.js'
import type { ChatCompletionCreateParamsStreaming, ChatCompletionMessageParam } from './openai-types.js'

function streamParams(
  overrides: Partial<ChatCompletionCreateParamsStreaming> = {},
): ChatCompletionCreateParamsStreaming {
  return {
    model: 'qwen3.5:0.8b',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    ...overrides,
  }
}

describe('buildOllamaChatRequest', () => {
  it('maps sampling params and num_ctx into options', () => {
    const body = buildOllamaChatRequest(
      streamParams({
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        max_tokens: 2048,
        num_ctx: 32768,
      }),
    )
    expect(body['options']).toEqual({
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      num_predict: 2048,
      num_ctx: 32768,
    })
  })

  it('passes tools through', () => {
    const tools: import('./openai-types.js').ChatCompletionTool[] = [
      { type: 'function', function: { name: 'read_file', description: 'x', parameters: {} } },
    ]
    const body = buildOllamaChatRequest(streamParams({ tools }))
    expect(body['tools']).toEqual(tools)
  })

  it('maps enable_thinking to the native think field', () => {
    const body = buildOllamaChatRequest(streamParams({ chat_template_kwargs: { enable_thinking: true } }))
    expect(body['think']).toBe(true)
  })

  it('maps reasoning_effort none to think false', () => {
    const body = buildOllamaChatRequest(streamParams({ reasoning_effort: 'none' }))
    expect(body['think']).toBe(false)
  })

  it('maps a thinking-level reasoning_effort to think level', () => {
    const body = buildOllamaChatRequest(streamParams({ reasoning_effort: 'high' }))
    expect(body['think']).toBe('high')
  })

  it('clamps xhigh reasoning_effort to the native max level', () => {
    const body = buildOllamaChatRequest(streamParams({ reasoning_effort: 'xhigh' }))
    expect(body['think']).toBe('max')
  })

  it('clamps an unknown reasoning_effort to think true', () => {
    const body = buildOllamaChatRequest(streamParams({ reasoning_effort: 'custom' }))
    expect(body['think']).toBe(true)
  })

  it('parses string tool_call arguments in history messages into objects', () => {
    const messages = [
      { role: 'user', content: 'what is the weather?' },
      {
        role: 'assistant',
        content: ' ',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
          },
        ],
      },
      { role: 'tool', content: '22C', tool_call_id: 'call_1' },
      { role: 'user', content: 'and in Lyon?' },
    ] as ChatCompletionMessageParam[]
    const body = buildOllamaChatRequest(streamParams({ messages }))
    expect(body['messages']).toEqual([
      { role: 'user', content: 'what is the weather?' },
      {
        role: 'assistant',
        content: ' ',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: { city: 'Paris' } } },
        ],
      },
      { role: 'tool', content: '22C', tool_call_id: 'call_1' },
      { role: 'user', content: 'and in Lyon?' },
    ])
  })

  it('leaves object tool_call arguments and non-tool messages untouched', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: ' ',
        tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'run', arguments: { cmd: 'ls' } } }],
      },
    ] as ChatCompletionMessageParam[]
    const body = buildOllamaChatRequest(streamParams({ messages }))
    expect(body['messages']).toStrictEqual(messages)
  })

  it('converts OpenAI content array with text and image_url to Ollama-native format', () => {
    const base64Image =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } },
          { type: 'text', text: 'Please be detailed.' },
        ],
      },
    ] as ChatCompletionMessageParam[]
    const body = buildOllamaChatRequest(streamParams({ messages }))
    expect(body['messages']).toEqual([
      {
        role: 'user',
        content: 'What is in this image?\nPlease be detailed.',
        images: [base64Image],
      },
    ])
  })

  it('converts content array with multiple image_url parts', () => {
    const img1 = 'img1base64data'
    const img2 = 'img2base64data'
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${img1}` } },
          { type: 'text', text: 'and this' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${img2}` } },
        ],
      },
    ] as ChatCompletionMessageParam[]
    const body = buildOllamaChatRequest(streamParams({ messages }))
    expect(body['messages']).toEqual([
      {
        role: 'user',
        content: 'and this',
        images: [img1, img2],
      },
    ])
  })
})

describe('parseOllamaChatResponse', () => {
  it('maps content, thinking, and tool calls into the OpenAI shape', () => {
    const result = parseOllamaChatResponse({
      message: {
        role: 'assistant',
        content: 'Done',
        thinking: 'let me think',
        tool_calls: [
          {
            id: 'call_abc',
            function: { index: 0, name: 'read_file', arguments: { path: '/tmp/x' } },
          },
        ],
      },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 100,
      eval_count: 50,
    })

    expect(result.choices[0]!.message.content).toBe('Done')
    expect(result.choices[0]!.message.thinking).toBe('let me think')
    expect(result.choices[0]!.message.tool_calls).toEqual([
      { id: 'call_abc', type: 'function', function: { name: 'read_file', arguments: '{"path":"/tmp/x"}' } },
    ])
    expect(result.choices[0]!.finish_reason).toBe('stop')
    expect(result.usage).toEqual({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 })
  })
})

describe('parseOllamaChatChunk', () => {
  it('maps content and thinking deltas', () => {
    const chunk = parseOllamaChatChunk({
      message: { role: 'assistant', content: 'He', thinking: 'I should' },
    })
    expect(chunk.choices[0]!.delta.content).toBe('He')
    expect(chunk.choices[0]!.delta.thinking).toBe('I should')
    expect(chunk.choices[0]!.finish_reason).toBeNull()
  })

  it('maps tool calls with index and stringified arguments', () => {
    const chunk = parseOllamaChatChunk({
      message: {
        role: 'assistant',
        tool_calls: [{ id: 'call_x', function: { index: 2, name: 'run_command', arguments: { command: 'ls' } } }],
      },
    })
    expect(chunk.choices[0]!.delta.tool_calls).toEqual([
      { index: 2, id: 'call_x', function: { name: 'run_command', arguments: '{"command":"ls"}' } },
    ])
  })

  it('maps the final chunk with usage and finish_reason', () => {
    const chunk = parseOllamaChatChunk({
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 200,
      eval_count: 30,
    })
    expect(chunk.choices[0]!.finish_reason).toBe('stop')
    expect(chunk.usage).toEqual({ prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 })
  })
})
