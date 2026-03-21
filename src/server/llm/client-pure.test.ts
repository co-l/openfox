import { describe, expect, it } from 'vitest'
import {
  buildNonStreamingCreateParams,
  buildStreamingCreateParams,
  convertMessages,
  convertTools,
  extractThinking,
  mapFinishReason,
} from './client-pure.js'

describe('llm client pure helpers', () => {
  it('converts messages and filters empty assistant placeholders', () => {
    expect(convertMessages([
      { role: 'system', content: 'system' },
      { role: 'assistant', content: '', toolCalls: [] },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'glob', arguments: { pattern: '*.ts' } }] },
      { role: 'tool', content: 'ok', toolCallId: 'call-1' },
    ])).toEqual([
      { role: 'system', content: 'system' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'glob', arguments: '{"pattern":"*.ts"}' } }],
      },
      { role: 'tool', content: 'ok', tool_call_id: 'call-1' },
    ])
  })

  it('converts tool definitions to openai function schema', () => {
    expect(convertTools([
      { type: 'function', function: { name: 'grep', description: 'Search', parameters: { type: 'object' } } },
    ])).toEqual([
      { type: 'function', function: { name: 'grep', description: 'Search', parameters: { type: 'object' } } },
    ])
  })

  it('maps finish reasons and extracts thinking tags', () => {
    expect(mapFinishReason('stop')).toBe('stop')
    expect(mapFinishReason('tool_calls')).toBe('tool_calls')
    expect(mapFinishReason('length')).toBe('length')
    expect(mapFinishReason('content_filter')).toBe('content_filter')
    expect(mapFinishReason('weird')).toBe('stop')

    expect(extractThinking('before<think>plan</think>after<think>more</think>')).toEqual({
      content: 'beforeafter',
      thinkingContent: 'planmore',
    })
    expect(extractThinking('plain text')).toEqual({
      content: 'plain text',
      thinkingContent: null,
    })
  })

  it('builds request params with backend capabilities and profile defaults', () => {
    const baseRequest = {
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [{ type: 'function' as const, function: { name: 'glob', description: 'Search', parameters: { type: 'object' } } }],
      toolChoice: 'auto' as const,
      enableThinking: false,
    }
    const profile = {
      temperature: 0.2,
      defaultMaxTokens: 2000,
      topP: 0.9,
      topK: 40,
      supportsReasoning: true,
    }

    expect(buildNonStreamingCreateParams({
      model: 'test-model',
      request: baseRequest,
      profile,
      capabilities: { supportsTopK: true, supportsChatTemplateKwargs: true },
    })).toEqual({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ type: 'function', function: { name: 'glob', description: 'Search', parameters: { type: 'object' } } }],
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 2000,
      top_p: 0.9,
      top_k: 40,
      stream: false,
    })

    expect(buildStreamingCreateParams({
      model: 'test-model',
      request: baseRequest,
      profile,
      capabilities: { supportsTopK: true, supportsChatTemplateKwargs: true },
      disableThinking: false,
    })).toEqual({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ type: 'function', function: { name: 'glob', description: 'Search', parameters: { type: 'object' } } }],
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 2000,
      top_p: 0.9,
      top_k: 40,
      stream: true,
      stream_options: { include_usage: true },
      chat_template_kwargs: { enable_thinking: false },
    })
  })
})
