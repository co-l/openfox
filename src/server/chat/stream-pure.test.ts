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
  evaluateLLMRetry,
  hasRecentLLMFailure,
  recordLLMFailure,
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

  it('excludes omitted params from result.modelParams so stats reflect the wire request', async () => {
    const client = createMockClient([
      { type: 'text_delta', content: 'hi' },
      {
        type: 'done',
        response: {
          id: 'resp-omit',
          content: 'hi',
          toolCalls: [],
          finishReason: 'stop',
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        },
      },
    ])

    const gen = streamLLMPure({
      messageId: 'msg-omit',
      systemPrompt: 'system',
      llmClient: client,
      messages: [{ role: 'user', content: 'hello' }],
      modelSettings: { omitParams: ['temperature', 'max_tokens'] },
    })

    const result = await consumeStreamGenerator(gen, () => {})

    expect(result.modelParams).not.toHaveProperty('temperature')
    expect(result.modelParams).not.toHaveProperty('maxTokens')
    expect(result.modelParams).toHaveProperty('topP')
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

  it('marks the result as errored without emitting chat.error when the stream reports an error', async () => {
    const client = createMockClient([{ type: 'error', error: 'boom' }])

    const gen = streamLLMPure({
      messageId: 'msg-error',
      systemPrompt: 'system',
      llmClient: client,
      messages: [{ role: 'user', content: 'hello' }],
    })

    const events: Array<{ type: string; data: unknown }> = []
    const result = await consumeStreamGenerator(gen, (event) => {
      events.push(event)
    })

    // A request that fails before any content emits nothing (case 1) — and the
    // caller owns failure UX, so no chat.error is emitted.
    expect(events).toEqual([])
    expect(result.error).toBe('boom')
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 })
  })

  it('streams partial content live when the stream fails mid-flight (case 2)', async () => {
    const client = createMockClient([
      { type: 'text_delta', content: 'partial ' },
      { type: 'text_delta', content: 'work' },
      { type: 'error', error: 'boom' },
    ])

    const gen = streamLLMPure({
      messageId: 'msg-partial',
      systemPrompt: 'system',
      llmClient: client,
      messages: [{ role: 'user', content: 'hello' }],
    })

    const events: Array<{ type: string; data: unknown }> = []
    const result = await consumeStreamGenerator(gen, (event) => {
      events.push(event)
    })

    // The partial content stays visible (kept in history by the caller); the
    // caller decides how to continue. No chat.error is emitted.
    expect(events).toEqual([
      { type: 'message.delta', data: { messageId: 'msg-partial', content: 'partial ' } },
      { type: 'message.delta', data: { messageId: 'msg-partial', content: 'work' } },
    ])
    expect(result.error).toBe('boom')
  })

  it('does not emit chat.error when aborted mid-stream', async () => {
    vi.useFakeTimers()

    const controller = new AbortController()
    const events: Array<{ type: string; data: unknown }> = []

    const client = {
      complete: async () => {
        throw new Error('Not implemented')
      },
      getModel: () => 'test-model',
      getProfile: () => ({}) as never,
      getBackend: () => 'unknown' as const,
      setBackend: () => {},
      setModel: () => {},
      stream: async function* (_request: { signal?: AbortSignal }) {
        yield { type: 'text_delta' as const, content: 'Hello ' }
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
        // Simulate the AbortError a real HTTP client throws when signal fires mid-stream
        throw new Error('The operation was aborted')
      },
    }

    const gen = streamLLMPure({
      messageId: 'msg-abort',
      systemPrompt: 'system',
      llmClient: client,
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal,
    })

    const consumePromise = consumeStreamGenerator(gen, (event) => {
      events.push(event)
    })

    // Events stream live: the first text_delta is already visible before the
    // 10ms timer inside the mock client fires.
    await vi.advanceTimersByTimeAsync(1)
    expect(events.filter((e) => e.type === 'message.delta')).toHaveLength(1)

    // Abort mid-stream — signal fires while the mock client is still awaiting
    controller.abort()

    // Advance past the remaining timer → mock client throws →
    // streamWithSegments yields 'error' → the turn is aborted, not a failure
    await vi.advanceTimersByTimeAsync(10)

    const result = await consumePromise

    expect(events.filter((e) => e.type === 'chat.error')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'message.delta')).toHaveLength(1)
    expect(result.aborted).toBe(true)
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

  describe('evaluateLLMRetry', () => {
    const policy = {
      backoffMs: [1000, 5000, 30_000],
      minIntervalMs: 60_000,
      maxDurationMs: 30 * 60_000,
      maxAttempts: 40,
    }

    it('escalates delays through the backoff ladder, then holds at the steady interval', () => {
      const now = 1_000_000
      expect(evaluateLLMRetry(1, now, now, policy)).toEqual({ retry: true, delayMs: 1000, attempt: 2 })
      expect(evaluateLLMRetry(2, now, now, policy)).toEqual({ retry: true, delayMs: 5000, attempt: 3 })
      expect(evaluateLLMRetry(3, now, now, policy)).toEqual({ retry: true, delayMs: 30_000, attempt: 4 })
      expect(evaluateLLMRetry(4, now, now, policy)).toEqual({ retry: true, delayMs: 60_000, attempt: 5 })
      expect(evaluateLLMRetry(10, now, now, policy)).toEqual({ retry: true, delayMs: 60_000, attempt: 11 })
    })

    it('gives up once the retry window elapses', () => {
      const first = 1_000_000
      const before = first + 30 * 60_000 - 1
      const after = first + 30 * 60_000
      expect(evaluateLLMRetry(5, first, before, policy)).toEqual({ retry: true, delayMs: 60_000, attempt: 6 })
      expect(evaluateLLMRetry(5, first, after, policy)).toEqual({ retry: false })
    })

    it('gives up once the attempt backstop is reached', () => {
      const now = 1_000_000
      expect(evaluateLLMRetry(39, now, now, policy)).toEqual({ retry: true, delayMs: 60_000, attempt: 40 })
      expect(evaluateLLMRetry(40, now, now, policy)).toEqual({ retry: false })
    })
  })

  describe('hasRecentLLMFailure', () => {
    it('reports failures recorded inside the window', () => {
      recordLLMFailure('session-window-ok')
      expect(hasRecentLLMFailure('session-window-ok', 30 * 60_000)).toBe(true)
    })

    it('prunes expired entries lazily so the map cannot grow unbounded', () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(1_700_000_000_000)
        recordLLMFailure('session-expired')
        // Far past the 30-minute window
        vi.setSystemTime(1_700_000_000_000 + 61 * 60_000)
        expect(hasRecentLLMFailure('session-expired', 30 * 60_000)).toBe(false)
        // Even a huge window no longer reports it — the entry was actually removed
        expect(hasRecentLLMFailure('session-expired', 365 * 24 * 3600 * 1000)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
