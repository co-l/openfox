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
    expect(
      convertMessages(
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
        { modelSupportsVision: false, visionFallbackEnabled: false },
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

  it('passes reasoning_content through on assistant messages with thinkingContent', () => {
    const result = convertMessages(
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
      { modelSupportsVision: false, visionFallbackEnabled: false },
    )

    // First assistant message with tool calls includes reasoning_content
    const firstAssistant = result[0] as unknown as Record<string, unknown>
    expect(firstAssistant['role']).toBe('assistant')
    expect(firstAssistant['content']).toBeNull()
    expect(firstAssistant['reasoning_content']).toBe('I need to read the file first')
    expect(firstAssistant['tool_calls']).toBeDefined()

    // Second assistant message (no tool calls) also includes reasoning_content
    const secondAssistant = result[2] as unknown as Record<string, unknown>
    expect(secondAssistant['role']).toBe('assistant')
    expect(secondAssistant['content']).toBe('Here is the file.')
    expect(secondAssistant['reasoning_content']).toBe('Summarizing the result')
  })

  it('converts tool definitions to openai function schema', () => {
    expect(
      convertTools([
        { type: 'function', function: { name: 'grep', description: 'Search', parameters: { type: 'object' } } },
      ]),
    ).toEqual([{ type: 'function', function: { name: 'grep', description: 'Search', parameters: { type: 'object' } } }])
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
      disableThinking: false,
    }
    const profile = {
      temperature: 0.2,
      defaultMaxTokens: 2000,
      topP: 0.9,
      topK: 40,
      supportsReasoning: true,
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

    expect(
      await buildStreamingCreateParams({
        model: 'test-model',
        request: baseRequest,
        profile,
        capabilities: { supportsTopK: true, supportsChatTemplateKwargs: true },
        disableThinking: true,
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

    // Non-streaming should respect request.disableThinking
    expect(
      await buildNonStreamingCreateParams({
        model: 'test-model',
        request: { ...baseRequest, disableThinking: true },
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
        chat_template_kwargs: { enable_thinking: false },
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
  })
})
