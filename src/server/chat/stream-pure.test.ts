import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LLMCompletionResponse, LLMStreamEvent } from '../llm/types.js'
import {
  TurnMetrics,
  consumeStreamGenerator,
  createChatDoneEvent,
  createFormatRetryEvent,
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
    const result = await consumeStreamGenerator(gen, event => {
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
      xmlFormatError: false,
    })
  })

  it('marks XML tool output as a format error and returns an empty result', async () => {
    const client = createMockClient([
      { type: 'text_delta', content: '<tool_call><function=' },
    ])

    const gen = streamLLMPure({
      messageId: 'msg-2',
      systemPrompt: 'system',
      llmClient: client,
      messages: [{ role: 'user', content: 'hello' }],
    })

    const events: Array<{ type: string; data: unknown }> = []
    const result = await consumeStreamGenerator(gen, event => {
      events.push(event)
    })

    expect(events).toEqual([])
    expect(result).toEqual({
      content: '',
      toolCalls: [],
      segments: [],
      usage: { promptTokens: 0, completionTokens: 0 },
      timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
      aborted: false,
      xmlFormatError: true,
    })
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
    expect(result.xmlFormatError).toBe(false)
    expect(result.content).toBe('')
  })

  it('aggregates turn metrics across llm calls and tool time', () => {
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(7_000)

    const metrics = new TurnMetrics()
    metrics.addLLMCall({ ttft: 2, completionTime: 4, tps: 8, prefillTps: 25 }, 50, 32)
    metrics.addLLMCall({ ttft: 1, completionTime: 3, tps: 7, prefillTps: 20 }, 25, 18)
    metrics.addToolTime(500)

    expect(metrics.buildStats('test-model', 'builder')).toEqual({
      model: 'test-model',
      mode: 'builder',
      totalTime: 6,
      toolTime: 0.5,
      prefillTokens: 75,
      prefillSpeed: 25,
      generationTokens: 50,
      generationSpeed: 7.1,
    })
  })

  it('creates event helper objects with optional fields only when present', () => {
    expect(createMessageStartEvent('msg-1', 'assistant')).toEqual({
      type: 'message.start',
      data: { messageId: 'msg-1', role: 'assistant' },
    })

    expect(createMessageStartEvent('msg-2', 'user', 'hello', {
      contextWindowId: 'window-1',
      subAgentId: 'sub-1',
      subAgentType: 'verifier',
      isSystemGenerated: true,
      messageKind: 'correction',
    })).toEqual({
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

    expect(createToolResultEvent('msg-4', 'call-1', {
      success: true,
      output: 'ok',
      durationMs: 1,
      truncated: false,
    })).toEqual({
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

    expect(createFormatRetryEvent(2, 10)).toEqual({
      type: 'format.retry',
      data: { attempt: 2, maxAttempts: 10 },
    })
  })
})
