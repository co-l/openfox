import { describe, expect, it } from 'vitest'
import {
  buildNonStreamingCreateParams,
  buildStreamingCreateParams,
  convertMessages,
  convertTools,
  mapFinishReason,
} from './client-pure.js'

describe('llm client pure helpers', () => {
  it('converts messages and filters empty assistant placeholders', async () => {
    expect(
      await convertMessages(
        [
          { role: 'system', content: 'system' },
          { role: 'assistant', content: '', toolCalls: [] },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call-1', name: 'glob', arguments: { pattern: '*.ts' } }],
          },
          { role: 'tool', content: 'ok', toolCallId: 'call-1' },
        ],
        false,
      ),
    ).toEqual([
      { role: 'system', content: 'system' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'glob', arguments: '{"pattern":"*.ts"}' } }],
      },
      { role: 'tool', content: 'ok', tool_call_id: 'call-1' },
    ])
  })

  it('passes reasoning through on assistant messages with thinkingContent', async () => {
    const result = await convertMessages(
      [
        {
          role: 'assistant',
          content: '',
          thinkingContent: 'I need to read the file first',
          toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'foo.ts' } }],
        },
        { role: 'tool', content: 'file contents', toolCallId: 'call-1' },
        { role: 'assistant', content: 'Here is the file.', thinkingContent: 'Summarizing the result' },
      ],
      false,
    )

    // First assistant message with tool calls includes reasoning
    const firstAssistant = result[0] as unknown as Record<string, unknown>
    expect(firstAssistant['role']).toBe('assistant')
    expect(firstAssistant['content']).toBeNull()
    expect(firstAssistant['reasoning']).toBe('I need to read the file first')
    expect(firstAssistant['tool_calls']).toBeDefined()

    // Second assistant message (no tool calls) also includes reasoning
    const secondAssistant = result[2] as unknown as Record<string, unknown>
    expect(secondAssistant['role']).toBe('assistant')
    expect(secondAssistant['content']).toBe('Here is the file.')
    expect(secondAssistant['reasoning']).toBe('Summarizing the result')
  })

  it('converts tool definitions to openai function schema', () => {
    expect(
      convertTools([
        { type: 'function', function: { name: 'grep', description: 'Search', parameters: { type: 'object' } } },
      ]),
    ).toEqual([{ type: 'function', function: { name: 'grep', description: 'Search', parameters: { type: 'object' } } }])
  })

  it('maps finish reasons', () => {
    expect(mapFinishReason('stop')).toBe('stop')
    expect(mapFinishReason('tool_calls')).toBe('tool_calls')
    expect(mapFinishReason('length')).toBe('length')
    expect(mapFinishReason('content_filter')).toBe('content_filter')
    expect(mapFinishReason('weird')).toBe('stop')
  })

  it('builds request params with backend capabilities and profile defaults', async () => {
    const baseRequest = {
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [
        {
          type: 'function' as const,
          function: { name: 'glob', description: 'Search', parameters: { type: 'object' } },
        },
      ],
      toolChoice: 'auto' as const,
    }
    const profile = {
      temperature: 0.2,
      defaultMaxTokens: 2000,
      topP: 0.9,
      topK: 40,
      supportsVision: false,
    }

    expect(
      await buildNonStreamingCreateParams({
        model: 'test-model',
        request: baseRequest,
        profile,
        capabilities: { supportsTopK: true, supportsChatTemplateKwargs: true },
      }),
    ).toEqual({
      params: {
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [
          { type: 'function', function: { name: 'glob', description: 'Search', parameters: { type: 'object' } } },
        ],
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 2000,
        top_p: 0.9,
        top_k: 40,
        stream: false,
      },
      modelParams: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxTokens: 2000,
      },
    })

    // When modelSettings.chatTemplateKwargs is provided, reasoning_effort from client config
    // must NOT be injected — the user's explicit kwargs are the source of truth
    expect(
      await buildNonStreamingCreateParams({
        model: 'test-model',
        request: {
          ...baseRequest,
          modelSettings: { chatTemplateKwargs: { enable_thinking: false } },
        },
        profile,
        capabilities: { supportsTopK: true, supportsChatTemplateKwargs: true },
        reasoningEffort: 'high', // client config has reasoning_effort set
      }),
    ).toEqual({
      params: {
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [
          { type: 'function', function: { name: 'glob', description: 'Search', parameters: { type: 'object' } } },
        ],
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 2000,
        top_p: 0.9,
        top_k: 40,
        stream: false,
        chat_template_kwargs: { enable_thinking: false },
      },
      modelParams: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxTokens: 2000,
      },
    })

    // Non-thinking mode via modelSettings.chatTemplateKwargs should set chat_template_kwargs
    // without reasoning_effort
    expect(
      await buildStreamingCreateParams({
        model: 'test-model',
        request: {
          ...baseRequest,
          modelSettings: { chatTemplateKwargs: { enable_thinking: false } },
        },
        profile,
        capabilities: { supportsTopK: true, supportsChatTemplateKwargs: true },
      }),
    ).toEqual({
      params: {
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [
          { type: 'function', function: { name: 'glob', description: 'Search', parameters: { type: 'object' } } },
        ],
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 2000,
        top_p: 0.9,
        top_k: 40,
        stream: true,
        stream_options: { include_usage: true },
        chat_template_kwargs: { enable_thinking: false },
      },
      modelParams: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxTokens: 2000,
      },
    })

    // Non-thinking mode via modelSettings.queryParams — queryParams are merged, not exclusive
    expect(
      await buildNonStreamingCreateParams({
        model: 'test-model',
        request: {
          ...baseRequest,
          modelSettings: { queryParams: { disable_thinking: true, skip_special_tokens: false } },
        },
        profile,
        capabilities: { supportsTopK: true, supportsChatTemplateKwargs: true },
      }),
    ).toEqual({
      params: {
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [
          { type: 'function', function: { name: 'glob', description: 'Search', parameters: { type: 'object' } } },
        ],
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 2000,
        top_p: 0.9,
        top_k: 40,
        stream: false,
        disable_thinking: true,
        skip_special_tokens: false,
      },
      modelParams: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxTokens: 2000,
      },
    })

    // reasoning_effort from client config supersedes queryParams (user-set thinkingLevel wins)
    expect(
      await buildNonStreamingCreateParams({
        model: 'test-model',
        request: {
          ...baseRequest,
          modelSettings: { queryParams: { reasoning_effort: 'low' } },
        },
        profile,
        capabilities: { supportsTopK: true, supportsChatTemplateKwargs: true },
        reasoningEffort: 'max',
      }),
    ).toEqual({
      params: {
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [
          { type: 'function', function: { name: 'glob', description: 'Search', parameters: { type: 'object' } } },
        ],
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 2000,
        top_p: 0.9,
        top_k: 40,
        stream: false,
        reasoning_effort: 'max',
      },
      modelParams: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxTokens: 2000,
      },
    })

    // Empty tools array should be omitted (vLLM rejects tools: [])
    expect(
      await buildNonStreamingCreateParams({
        model: 'test-model',
        request: { messages: [{ role: 'user' as const, content: 'hi' }], tools: [] },
        profile,
        capabilities: { supportsTopK: false, supportsChatTemplateKwargs: false },
      }),
    ).toEqual({
      params: {
        model: 'test-model',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.2,
        max_tokens: 2000,
        top_p: 0.9,
        stream: false,
      },
      modelParams: {
        temperature: 0.2,
        topP: 0.9,
        maxTokens: 2000,
      },
    })

    // modelSettings should override profile defaults
    expect(
      await buildNonStreamingCreateParams({
        model: 'test-model',
        request: {
          messages: [{ role: 'user' as const, content: 'hi' }],
          modelSettings: { maxTokens: 5000, temperature: 0.5, topP: 0.95 },
        },
        profile,
        capabilities: { supportsTopK: false, supportsChatTemplateKwargs: false },
      }),
    ).toEqual({
      params: {
        model: 'test-model',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.5,
        max_tokens: 5000,
        top_p: 0.95,
        stream: false,
      },
      modelParams: {
        temperature: 0.5,
        topP: 0.95,
        maxTokens: 5000,
      },
    })
  })
})
