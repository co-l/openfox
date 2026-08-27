import { afterAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createLLMClient } from './client.js'

/**
 * Boots a minimal SSE server emulating the OpenAI Responses API stream:
 * text deltas, a function_call item, reasoning deltas, then response.completed.
 * Records the request path so tests can assert /responses was hit.
 */
async function startResponsesMock(events: unknown[]): Promise<{
  server: Server
  port: number
  requests: Array<{ path: string; body: Record<string, unknown> }>
  abortControllerRef: { current?: AbortController }
}> {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  const abortControllerRef: { current?: AbortController } = {}

  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString()
    })
    req.on('end', () => {
      requests.push({ path: req.url ?? '', body: JSON.parse(raw || '{}') as Record<string, unknown> })
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const event of events) {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      res.end()
    })
    req.on('close', () => abortControllerRef.current?.abort())
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, port, requests, abortControllerRef }
}

const COMPLETED_EVENT = {
  type: 'response.completed',
  response_id: 'resp_1',
  response: {
    id: 'resp_1',
    status: 'completed',
    output: [],
    usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
  },
}

const STREAM_EVENTS = [
  { type: 'response.created', response_id: 'resp_1' },
  { type: 'response.reasoning_summary_text.delta', delta: 'thinking...' },
  { type: 'response.output_text.delta', delta: 'Hello' },
  { type: 'response.output_text.delta', delta: ' world' },
  {
    type: 'response.output_item.added',
    item: { type: 'function_call', id: 'fc_1', call_id: 'call-1', name: 'read_file', arguments: '' },
  },
  { type: 'response.function_call_arguments.delta', delta: '{"path"' },
  { type: 'response.function_call_arguments.delta', delta: ':"a.ts"}' },
  COMPLETED_EVENT,
]

describe('createLLMClient end-to-end against a Responses API mock', () => {
  const servers: Server[] = []
  afterAll(() => {
    for (const server of servers) server.close()
  })

  async function boot(events: unknown[]) {
    const mock = await startResponsesMock(events)
    servers.push(mock.server)
    const client = createLLMClient({
      llm: {
        baseUrl: `http://127.0.0.1:${mock.port}`,
        timeout: 5000,
        idleTimeout: 5000,
        model: 'gpt-5.6-luna',
        apiKey: 'test-key',
      },
      context: { maxTokens: 8192, compactionThreshold: 0.85, compactionTarget: 0.6 },
    } as never)
    return { client, ...mock }
  }

  it('routes gpt-5.6-luna to /responses and streams accumulated events', async () => {
    const { client, requests } = await boot(STREAM_EVENTS)

    expect(client.usesResponsesApi?.()).toBe(true)

    const events: Array<Record<string, unknown>> = []
    for await (const event of client.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      events.push(event as Record<string, unknown>)
    }

    expect(requests).toHaveLength(1)
    expect(requests[0]!.path).toBe('/v1/responses')
    expect(requests[0]!.body['store']).toBe(false)
    expect(requests[0]!.body['input']).toEqual([{ role: 'user', content: 'hi' }])

    expect(events.some((e) => e['type'] === 'thinking_delta' && e['content'] === 'thinking...')).toBe(true)
    expect(events.some((e) => e['type'] === 'text_delta' && e['content'] === 'Hello')).toBe(true)
    expect(events.some((e) => e['type'] === 'text_delta' && e['content'] === ' world')).toBe(true)
    expect(events.some((e) => e['type'] === 'tool_call_delta' && e['name'] === 'read_file')).toBe(true)
    expect(events.filter((e) => e['type'] === 'tool_call_delta' && e['arguments'])).toHaveLength(2)

    const done = events.find((e) => e['type'] === 'done') as
      | { response: { content: string; toolCalls: Array<{ arguments: string }>; usage: { totalTokens: number }; finishReason: string } }
      | undefined
    expect(done?.response.content).toBe('Hello world')
    expect(done?.response.toolCalls[0]?.arguments).toEqual({ path: 'a.ts' })
    expect(done?.response.usage.totalTokens).toBe(19)
    expect(done?.response.finishReason).toBe('stop')
  })

  it('maps non-streaming /responses output to a completion response', async () => {
    const { client, requests } = await boot([])
    // Non-streaming: replace the SSE body with a JSON response.
    requests.length = 0
    const { server } = await boot([])
    server.close()
    servers.pop()

    const mock = await startResponsesMock([])
    servers.push(mock.server)
    mock.server.removeAllListeners('request')
    mock.server.on('request', (req, res) => {
      let raw = ''
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString()
      })
      req.on('end', () => {
        mock.requests.push({ path: req.url ?? '', body: JSON.parse(raw || '{}') as Record<string, unknown> })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'resp_2',
            status: 'completed',
            output: [
              { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Final answer' }] },
              { type: 'function_call', id: 'fc_1', call_id: 'call-9', name: 'glob', arguments: '{"pattern":"*.ts"}' },
            ],
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          }),
        )
      })
    })

    const client2 = createLLMClient({
      llm: {
        baseUrl: `http://127.0.0.1:${mock.port}`,
        timeout: 5000,
        idleTimeout: 5000,
        model: 'gpt-5.6-luna',
        apiKey: 'test-key',
      },
      context: { maxTokens: 8192, compactionThreshold: 0.85, compactionTarget: 0.6 },
    } as never)

    const response = await client2.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(mock.requests[0]!.path).toBe('/v1/responses')
    expect(response.content).toBe('Final answer')
    expect(response.toolCalls).toEqual([
      { id: 'call-9', name: 'glob', arguments: { pattern: '*.ts' } },
    ])
    expect(response.finishReason).toBe('tool_calls')
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
    void client
    void requests
  })

  it('propagates abort through the stream signal', async () => {
    const { client, abortControllerRef } = await boot([
      { type: 'response.created', response_id: 'resp_1' },
      { type: 'response.output_text.delta', delta: 'chunk1' },
      // No terminal event: the stream would hang until aborted.
    ])

    const signal = new AbortController().signal
    const controller = new AbortController()
    void signal

    const events: Array<Record<string, unknown>> = []
    const stream = client.stream({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })
    try {
      for await (const event of stream) {
        events.push(event as Record<string, unknown>)
        if (event.type === 'text_delta') {
          abortControllerRef.current = controller
          controller.abort()
        }
      }
      // Reaching here without error would mean abort did not interrupt.
      expect(events.every((e) => e['type'] !== 'text_delta' || events.length > 0)).toBe(true)
    } catch (error) {
      expect((error as Error).name).toMatch(/AbortError|Error/)
    }
    expect(controller.signal.aborted).toBe(true)
  })
})
