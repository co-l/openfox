import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LLMCompletionResponse, LLMStreamEvent } from '../llm/types.js'
import {
  TurnMetrics,
  consumeStreamGenerator,
  createChatDoneEvent,
  createMessageDoneEvent,
  createMessageStartEvent,
  createToolCallEvent,
  createToolResultEvent,
  streamLLMPure,
} from './stream-pure.js'

function createMockClient(events: LLMStreamEvent[]) {
  return {
    complete: async () => {
      throw new Error('Not implemented')
    },
    getModel: () => 'test-model',
    getProfile: () => ({}) as never,
    getBackend: () => 'unknown' as const,
    setBackend: () => {},
    setModel: () => {},
    stream: async function* () {
      for (const event of events) {
        yield event
      }
    },
  }
}

const mockResponse: LLMCompletionResponse = {
  id: 'resp-1',
  content: 'Final answer',
  thinkingContent: 'Thinking',
  toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
  finishReason: 'tool_calls',
  usage: {
    promptTokens: 120,
    completionTokens: 30,
    totalTokens: 150,
  },
}

describe('stream-pure', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('streams text, thinking, and tool preparation events and returns the final result', async () => {
    const client = createMockClient([
      { type: 'thinking_delta', content: 'Need to inspect files' },
      { type: 'text_delta', content: 'I will help.' },
      { type: 'tool_call_delta', index: 0, name: 'read_file' },
      { type: 'tool_call_delta', index: 0, arguments: '{"path":"src/index.ts"}' },
      { type: 'done', response: mockResponse },
    ])

    const gen = streamLLMPure({
      messageId: 'msg-1',
      systemPrompt: 'system',
      llmClient: client,
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } }],
    })

    const events: Array<{ type: string; data: unknown }> = []
    const result = await consumeStreamGenerator(gen, (event) => {
      events.push(event)
    })

    expect(events).toEqual([
      { type: 'message.thinking', data: { messageId: 'msg-1', content: 'Need to inspect files' } },
      { type: 'message.delta', data: { messageId: 'msg-1', content: 'I will help.' } },
      { type: 'tool.preparing', data: { messageId: 'msg-1', index: 0, name: 'read_file' } },
    ])
    expect(result).toEqual({
      content: 'I will help.',
      thinkingContent: 'Need to inspect files',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
      segments: [
        { type: 'thinking', content: 'Need to inspect files' },
        { type: 'text', content: 'I will help.' },
        { type: 'tool_call', toolCallId: 'call-1' },
      ],
      usage: { promptTokens: 120, completionTokens: 30 },
      timing: expect.objectContaining({ ttft: expect.any(Number), completionTime: expect.any(Number) }),
      aborted: false,
      modelParams: expect.objectContaining({
        temperature: expect.any(Number),
        topP: expect.any(Number),
        maxTokens: expect.any(Number),
      }),
      finishReason: 'tool_calls',
    })
  })

  it('streams partial arguments for run_command', async () => {
    const client = createMockClient([
      { type: 'tool_call_delta', index: 0, name: 'run_command' },
      { type: 'tool_call_delta', index: 0, arguments: '{"command":"echo' },
      { type: 'tool_call_delta', index: 0, arguments: ' hello"}' },
      {
        type: 'done',
        response: {
          id: 'resp-1',
          content: '',
          toolCalls: [{ id: 'call-1', name: 'run_command', arguments: { command: 'echo hello' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        },
      },
    ])

    const gen = streamLLMPure({
      messageId: 'msg-run',
      systemPrompt: 'system',
      llmClient: client,
      messages: [{ role: 'user', content: 'run' }],
      tools: [{ type: 'function', function: { name: 'run_command', description: 'Run', parameters: {} } }],
    })

    const events: Array<{ type: string; data: unknown }> = []
    await consumeStreamGenerator(gen, (event) => {
      events.push(event)
    })

    const preparingEvents = events.filter((e) => e.type === 'tool.preparing')
    expect(preparingEvents).toHaveLength(3)
    expect(preparingEvents[0]!).toMatchObject({ data: { name: 'run_command' } })
    expect(preparingEvents[1]!).toMatchObject({ data: { name: 'run_command', arguments: '{"command":"echo' } })
    expect(preparingEvents[2]!).toMatchObject({ data: { name: 'run_command', arguments: '{"command":"echo hello"}' } })
  })

  it('treats AbortError as an aborted result', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = createMockClient([])

    const gen = streamLLMPure({
      messageId: 'msg-3',
      systemPrompt: 'system',
      llmClient: client,
      messages: [{ role: 'user', content: 'hello' }],
      signal: controller.signal,
    })

    const result = await consumeStreamGenerator(gen, () => {})

    expect(result.aborted).toBe(true)
    expect(result.content).toBe('')
  })

  describe('prefTokenIncrement with context caching', () => {
    it('computes prefillSpeed from increment not total tokens when previousContextTokens provided', () => {
      const metrics = new TurnMetrics()
      // Context already had 78k tokens, new call sends 80k total (2k new from cache)
      metrics.addLLMCall({ ttft: 0.5, completionTime: 2, tps: 15, prefillTps: 0 }, 80_000, 500, 78_000)

      const stats = metrics.buildStats(
        { providerId: 'p', providerName: 'vLLM', backend: 'vllm', model: 'm' },
        'builder',
      )

      expect(stats.prefillTokens).toBe(80_000)
      expect(stats.llmCalls?.[0]?.prefTokenIncrement).toBe(2_000)
      // Old inflated: 80000 / 0.5 = 160000 tok/s
      // Correct: 2000 / 0.5 = 4000 tok/s
      expect(stats.prefillSpeed).toBe(4_000)
      expect(stats.llmCalls?.[0]?.prefillSpeed).toBe(4_000)
    })

    it('aggregates prefTokenIncrement across multiple calls with caching', () => {
      const metrics = new TurnMetrics()
      // Call 1: 78k prev -> 80k new = 2k increment
      metrics.addLLMCall({ ttft: 0.5, completionTime: 2, tps: 15, prefillTps: 0 }, 80_000, 500, 78_000)
      // Call 2: 80k prev -> 83k new = 3k increment
      metrics.addLLMCall({ ttft: 0.4, completionTime: 1.5, tps: 20, prefillTps: 0 }, 83_000, 400, 80_000)

      const stats = metrics.buildStats(
        { providerId: 'p', providerName: 'vLLM', backend: 'vllm', model: 'm' },
        'builder',
      )

      expect(stats.prefillTokens).toBe(163_000)
      expect(stats.llmCalls?.[0]?.prefTokenIncrement).toBe(2_000)
      expect(stats.llmCalls?.[1]?.prefTokenIncrement).toBe(3_000)
      // Total increment: 5000 tokens over 0.9s total ttft = ~5556 tok/s
      expect(stats.prefTokenIncrement).toBe(5_000)
      expect(stats.prefillSpeed).toBe(5_555.6) // rounded to 1 decimal: 5000/0.9 = 5555.6
    })

    it('falls back to total tokens when previousContextTokens is undefined', () => {
      const metrics = new TurnMetrics()
      metrics.addLLMCall({ ttft: 2, completionTime: 4, tps: 8, prefillTps: 25 }, 50, 32, undefined)

      const stats = metrics.buildStats(
        { providerId: 'p', providerName: 'vLLM', backend: 'vllm', model: 'm' },
        'builder',
      )

      expect(stats.llmCalls?.[0]?.prefTokenIncrement).toBeUndefined()
      expect(stats.prefillSpeed).toBe(25) // 50 / 2 = 25
    })

    it('handles context shrinking (negative increment clamped to 0)', () => {
      const metrics = new TurnMetrics()
      // Edge case: compaction reduced context, so new total is smaller
      metrics.addLLMCall({ ttft: 1, completionTime: 2, tps: 10, prefillTps: 0 }, 60_000, 300, 75_000)

      const stats = metrics.buildStats(
        { providerId: 'p', providerName: 'vLLM', backend: 'vllm', model: 'm' },
        'builder',
      )

      expect(stats.llmCalls?.[0]?.prefTokenIncrement).toBe(0) // max(0, 60000 - 75000)
    })
  })

  it('aggregates turn metrics across llm calls and tool time', () => {
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(7_000)

    const metrics = new TurnMetrics()
    metrics.addLLMCall({ ttft: 2, completionTime: 4, tps: 8, prefillTps: 25 }, 50, 32, undefined)
    metrics.addLLMCall({ ttft: 1, completionTime: 3, tps: 7, prefillTps: 20 }, 25, 18, undefined)
    metrics.addToolTime(500)

    expect(
      metrics.buildStats(
        {
          providerId: 'provider-1',
          providerName: 'Local vLLM',
          backend: 'vllm',
          model: 'test-model',
        },
        'builder',
      ),
    ).toMatchObject({
      providerId: 'provider-1',
      providerName: 'Local vLLM',
      backend: 'vllm',
      model: 'test-model',
      mode: 'builder',
      totalTime: 6,
      toolTime: 0.5,
      prefillTokens: 75,
      prefillSpeed: 25,
      generationTokens: 50,
      generationSpeed: 7.1,
      llmCalls: [
        {
          providerId: 'provider-1',
          providerName: 'Local vLLM',
          backend: 'vllm',
          model: 'test-model',
          callIndex: 1,
          promptTokens: 50,
          completionTokens: 32,
          ttft: 2,
          completionTime: 4,
          prefillSpeed: 25,
          generationSpeed: 8,
          totalTime: 6,
          timestamp: expect.any(String),
        },
        {
          providerId: 'provider-1',
          providerName: 'Local vLLM',
          backend: 'vllm',
          model: 'test-model',
          callIndex: 2,
          promptTokens: 25,
          completionTokens: 18,
          ttft: 1,
          completionTime: 3,
          prefillSpeed: 25,
          generationSpeed: 6,
          totalTime: 4,
          timestamp: expect.any(String),
        },
      ],
    })
  })

  it('creates event helper objects with optional fields only when present', () => {
    expect(createMessageStartEvent('msg-1', 'assistant')).toEqual({
      type: 'message.start',
      data: { messageId: 'msg-1', role: 'assistant' },
    })

    expect(
      createMessageStartEvent('msg-2', 'user', 'hello', {
        contextWindowId: 'window-1',
        subAgentId: 'sub-1',
        subAgentType: 'verifier',
        isSystemGenerated: true,
        messageKind: 'correction',
      }),
    ).toEqual({
      type: 'message.start',
      data: {
        messageId: 'msg-2',
        role: 'user',
        content: 'hello',
        contextWindowId: 'window-1',
        subAgentId: 'sub-1',
        subAgentType: 'verifier',
        isSystemGenerated: true,
        messageKind: 'correction',
      },
    })

    expect(createMessageDoneEvent('msg-3', { partial: true })).toEqual({
      type: 'message.done',
      data: { messageId: 'msg-3', partial: true },
    })

    expect(createToolCallEvent('msg-4', { id: 'call-1', name: 'glob', arguments: { pattern: '*.ts' } })).toEqual({
      type: 'tool.call',
      data: {
        messageId: 'msg-4',
        toolCall: { id: 'call-1', name: 'glob', arguments: { pattern: '*.ts' } },
      },
    })

    expect(
      createToolResultEvent('msg-4', 'call-1', {
        success: true,
        output: 'ok',
        durationMs: 1,
        truncated: false,
      }),
    ).toEqual({
      type: 'tool.result',
      data: {
        messageId: 'msg-4',
        toolCallId: 'call-1',
        result: { success: true, output: 'ok', durationMs: 1, truncated: false },
      },
    })

    expect(createChatDoneEvent('msg-5', 'complete')).toEqual({
      type: 'chat.done',
      data: { messageId: 'msg-5', reason: 'complete' },
    })
  })

  describe('retry pattern matching mid-stream', () => {
    it('aborts stream and returns patternMatch when content matches', async () => {
      const client = createMockClient([
        { type: 'text_delta', content: 'hello ' },
        { type: 'text_delta', content: 'error occurred' },
        { type: 'text_delta', content: ' more text' },
        { type: 'done', response: mockResponse },
      ])

      const gen = streamLLMPure({
        messageId: 'msg-retry',
        systemPrompt: 'system',
        llmClient: client,
        messages: [{ role: 'user', content: 'hello' }],
        retryPatterns: [{ field: 'content', pattern: 'error', action: 'retry', active: true }],
      })

      const events: Array<{ type: string; data: unknown }> = []
      const result = await consumeStreamGenerator(gen, (event) => {
        events.push(event)
      })

      // Should have streamed the content up to the match point
      expect(events.map((e) => e.type)).toEqual(['message.delta', 'message.delta'])
      expect(result.patternMatch).toBeDefined()
      expect(result.patternMatch!.pattern).toBe('error')
      expect(result.patternMatch!.field).toBe('content')
      expect(result.patternMatch!.matchedContent).toContain('error')
      expect(result.content).toBe('')
    })

    it('aborts stream when thinking matches', async () => {
      const client = createMockClient([
        { type: 'thinking_delta', content: 'I am ' },
        { type: 'thinking_delta', content: 'unsure about' },
        { type: 'text_delta', content: 'some text' },
        { type: 'done', response: mockResponse },
      ])

      const gen = streamLLMPure({
        messageId: 'msg-retry-thinking',
        systemPrompt: 'system',
        llmClient: client,
        messages: [{ role: 'user', content: 'hello' }],
        retryPatterns: [{ field: 'thinking', pattern: 'unsure', action: 'retry', active: true }],
      })

      const events: Array<{ type: string; data: unknown }> = []
      const result = await consumeStreamGenerator(gen, (event) => {
        events.push(event)
      })

      expect(result.patternMatch).toBeDefined()
      expect(result.patternMatch!.field).toBe('thinking')
      expect(result.patternMatch!.matchedContent).toContain('unsure')
    })

    it('completes normally when no pattern matches', async () => {
      const client = createMockClient([
        { type: 'text_delta', content: 'everything is fine' },
        { type: 'done', response: mockResponse },
      ])

      const gen = streamLLMPure({
        messageId: 'msg-no-match',
        systemPrompt: 'system',
        llmClient: client,
        messages: [{ role: 'user', content: 'hello' }],
        retryPatterns: [{ field: 'content', pattern: 'error', action: 'retry', active: true }],
      })

      const result = await consumeStreamGenerator(gen, () => {})

      expect(result.patternMatch).toBeUndefined()
      expect(result.content).toBe('everything is fine')
    })

    it('ignores inactive patterns', async () => {
      const client = createMockClient([
        { type: 'text_delta', content: 'error occurred' },
        { type: 'done', response: mockResponse },
      ])

      const gen = streamLLMPure({
        messageId: 'msg-inactive',
        systemPrompt: 'system',
        llmClient: client,
        messages: [{ role: 'user', content: 'hello' }],
        retryPatterns: [{ field: 'content', pattern: 'error', action: 'retry', active: false }],
      })

      const result = await consumeStreamGenerator(gen, () => {})

      expect(result.patternMatch).toBeUndefined()
      expect(result.content).toBe('error occurred')
    })

    it('returns first match when multiple patterns match', async () => {
      const client = createMockClient([
        { type: 'text_delta', content: 'error and warning' },
        { type: 'done', response: mockResponse },
      ])

      const gen = streamLLMPure({
        messageId: 'msg-multi',
        systemPrompt: 'system',
        llmClient: client,
        messages: [{ role: 'user', content: 'hello' }],
        retryPatterns: [
          { field: 'content', pattern: 'warning', action: 'retry', active: true },
          { field: 'content', pattern: 'error', action: 'retry', active: true },
        ],
      })

      const result = await consumeStreamGenerator(gen, () => {})

      // Should match the first pattern that triggers (the one that appears first in content)
      expect(result.patternMatch).toBeDefined()
    })
  })
})
