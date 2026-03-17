import { describe, it, expect } from 'vitest'
import { streamWithSegments, type StreamEvent } from './streaming.js'
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
    const toolDeltas = events.filter(e => e.type === 'tool_call_delta')
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
      { type: 'done', response: { ...mockResponse, toolCalls: [
        { id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } },
        { id: 'call-2', name: 'glob', arguments: { pattern: '*.ts' } },
      ]}},
    ])

    const events: StreamEvent[] = []
    const stream = streamWithSegments(client, { messages: [] })

    for await (const event of stream) {
      events.push(event)
    }

    const toolDeltas = events.filter(e => e.type === 'tool_call_delta')
    expect(toolDeltas).toHaveLength(4)
    
    // Check each index has its own events
    const index0Events = toolDeltas.filter(e => e.type === 'tool_call_delta' && e.index === 0)
    const index1Events = toolDeltas.filter(e => e.type === 'tool_call_delta' && e.index === 1)
    
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

    const delta = events.find(e => e.type === 'tool_call_delta')
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
    let result: Awaited<ReturnType<typeof stream.next>>['value'] = null

    for await (const event of stream) {
      if (event.type === 'done') {
        // Get the return value
      }
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
})
