import { describe, it, expect } from 'vitest'
import { SegmentBuilder, streamWithSegments, type StreamEvent } from './streaming.js'
import type { LLMClient, LLMStreamEvent, LLMCompletionResponse } from './types.js'

// Helper to create a mock LLM client
function createMockClient(events: LLMStreamEvent[]): LLMClient {
  return {
    complete: async () => {
      throw new Error('Not implemented')
    },
    stream: async function* () {
      for (const event of events) {
        yield event
      }
    },
  }
}

const mockResponse: LLMCompletionResponse = {
  id: 'test-id',
  content: '',
  finishReason: 'tool_calls',
  toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
}

describe('streamWithSegments', () => {
  it('forwards tool_call_delta events from LLM client', async () => {
    const client = createMockClient([
      { type: 'tool_call_delta', index: 0, id: 'call-1', name: 'read_file' },
      { type: 'tool_call_delta', index: 0, arguments: '{"path":"src/' },
      { type: 'tool_call_delta', index: 0, arguments: 'index.ts"}' },
      { type: 'done', response: mockResponse },
    ])

    const events: StreamEvent[] = []
    const stream = streamWithSegments(client, { messages: [] })

    for await (const event of stream) {
      events.push(event)
    }

    // Should include tool_call_delta events
    const toolDeltas = events.filter((e) => e.type === 'tool_call_delta')
    expect(toolDeltas).toHaveLength(3)
    expect(toolDeltas[0]).toMatchObject({ type: 'tool_call_delta', index: 0, name: 'read_file' })
    expect(toolDeltas[1]).toMatchObject({ type: 'tool_call_delta', index: 0, arguments: '{"path":"src/' })
    expect(toolDeltas[2]).toMatchObject({ type: 'tool_call_delta', index: 0, arguments: 'index.ts"}' })
  })

  it('forwards tool_call_delta events for multiple parallel tool calls', async () => {
    const client = createMockClient([
      { type: 'tool_call_delta', index: 0, id: 'call-1', name: 'read_file' },
      { type: 'tool_call_delta', index: 1, id: 'call-2', name: 'glob' },
      { type: 'tool_call_delta', index: 0, arguments: '{"path":"a.ts"}' },
      { type: 'tool_call_delta', index: 1, arguments: '{"pattern":"*.ts"}' },
      {
        type: 'done',
        response: {
          ...mockResponse,
          toolCalls: [
            { id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } },
            { id: 'call-2', name: 'glob', arguments: { pattern: '*.ts' } },
          ],
        },
      },
    ])

    const events: StreamEvent[] = []
    const stream = streamWithSegments(client, { messages: [] })

    for await (const event of stream) {
      events.push(event)
    }

    const toolDeltas = events.filter((e) => e.type === 'tool_call_delta')
    expect(toolDeltas).toHaveLength(4)

    // Check each index has its own events
    const index0Events = toolDeltas.filter((e) => e.type === 'tool_call_delta' && e.index === 0)
    const index1Events = toolDeltas.filter((e) => e.type === 'tool_call_delta' && e.index === 1)

    expect(index0Events).toHaveLength(2)
    expect(index1Events).toHaveLength(2)
  })

  it('only includes defined properties in tool_call_delta', async () => {
    const client = createMockClient([
      { type: 'tool_call_delta', index: 0, name: 'read_file' }, // no id or arguments
      { type: 'done', response: mockResponse },
    ])

    const events: StreamEvent[] = []
    const stream = streamWithSegments(client, { messages: [] })

    for await (const event of stream) {
      events.push(event)
    }

    const delta = events.find((e) => e.type === 'tool_call_delta')
    expect(delta).toBeDefined()
    expect(delta).toMatchObject({ type: 'tool_call_delta', index: 0, name: 'read_file' })
    expect('id' in delta!).toBe(false)
    expect('arguments' in delta!).toBe(false)
  })

  it('does not create segments for whitespace-only thinking content', async () => {
    const textResponse: LLMCompletionResponse = {
      id: 'test-id',
      content: 'Hello',
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
    }

    const client = createMockClient([
      { type: 'thinking_delta', content: '\n\n' },
      { type: 'text_delta', content: 'Hello' },
      { type: 'done', response: textResponse },
    ])

    const stream = streamWithSegments(client, { messages: [] })

    for await (const _event of stream) {
      // Just consume
    }

    // Consume generator to get return value
    const gen = streamWithSegments(client, { messages: [] })
    let returnValue
    while (true) {
      const { value, done } = await gen.next()
      if (done) {
        returnValue = value
        break
      }
    }

    // Should only have text segment, not whitespace-only thinking
    expect(returnValue).not.toBeNull()
    expect(returnValue!.segments).toHaveLength(1)
    expect(returnValue!.segments[0]!.type).toBe('text')
  })

  it('does not create segments for whitespace-only text content', async () => {
    const textResponse: LLMCompletionResponse = {
      id: 'test-id',
      content: 'Hello',
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
    }

    const client = createMockClient([
      { type: 'text_delta', content: '  \n  ' },
      { type: 'thinking_delta', content: 'Thinking...' },
      { type: 'text_delta', content: 'Hello' },
      { type: 'done', response: textResponse },
    ])

    const gen = streamWithSegments(client, { messages: [] })
    let returnValue
    while (true) {
      const { value, done } = await gen.next()
      if (done) {
        returnValue = value
        break
      }
    }

    // Should have thinking and text segments, but not the whitespace-only text
    expect(returnValue).not.toBeNull()
    expect(returnValue!.segments).toHaveLength(2)
    expect(returnValue!.segments[0]!.type).toBe('thinking')
    expect(returnValue!.segments[1]!.type).toBe('text')
    const textSegment = returnValue!.segments[1]!
    if (textSegment.type === 'text') {
      expect(textSegment.content).toBe('Hello')
    }
  })

  it('aborts immediately on xml tool syntax and returns null', async () => {
    const client = createMockClient([{ type: 'text_delta', content: '<tool_call>' }])

    const events: StreamEvent[] = []
    const gen = streamWithSegments(client, { messages: [] })
    let returnValue: unknown = undefined
    while (true) {
      const { value, done } = await gen.next()
      if (done) {
        returnValue = value
        break
      }
      events.push(value)
    }

    expect(events).toEqual([{ type: 'xml_tool_abort' }])
    expect(returnValue).toBeNull()
  })

  it('returns null on explicit error events and abort errors', async () => {
    const errorClient = createMockClient([{ type: 'error', error: 'backend failed' }])
    const errorEvents: StreamEvent[] = []
    const errorGen = streamWithSegments(errorClient, { messages: [] })
    let errorResult: unknown = undefined
    while (true) {
      const { value, done } = await errorGen.next()
      if (done) {
        errorResult = value
        break
      }
      errorEvents.push(value)
    }
    expect(errorEvents).toEqual([{ type: 'error', error: 'backend failed' }])
    expect(errorResult).toBeNull()

    const abortClient: LLMClient = {
      complete: async () => {
        throw new Error('Not implemented')
      },
      stream: async function* () {
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      },
    }
    const abortGen = streamWithSegments(abortClient, { messages: [] })
    const abortDone = await abortGen.next()
    expect(abortDone.done).toBe(true)
    expect(abortDone.value).toBeNull()
  })

  it('returns null if the stream ends without a done response', async () => {
    const client = createMockClient([{ type: 'text_delta', content: 'partial' }])

    const gen = streamWithSegments(client, { messages: [] })
    let result: unknown = undefined
    while (true) {
      const { value, done } = await gen.next()
      if (done) {
        result = value
        break
      }
    }

    expect(result).toBeNull()
  })

  it('accumulates and clears segments with SegmentBuilder', () => {
    const builder = new SegmentBuilder()
    builder.addFromResult({
      content: 'Hello',
      thinkingContent: 'Think',
      toolCalls: [{ id: 'call-1', name: 'glob', arguments: { pattern: '*.ts' } }],
      response: mockResponse,
      segments: [
        { type: 'thinking', content: 'Think' },
        { type: 'text', content: 'Hello' },
      ],
      timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 1 },
    })
    builder.addToolCall('call-2')

    expect(builder.build()).toEqual([
      { type: 'thinking', content: 'Think' },
      { type: 'text', content: 'Hello' },
      { type: 'tool_call', toolCallId: 'call-2' },
    ])

    builder.clear()
    expect(builder.build()).toEqual([])
  })
})
