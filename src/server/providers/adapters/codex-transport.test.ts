import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import type { ProviderAuthAdapter } from './types.js'
import { CodexTransportAdapter } from './codex-transport.js'

function stream(events: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      controller.close()
    },
  })
}

const auth: ProviderAuthAdapter = {
  id: 'openai-account',
  getStatus: vi.fn(),
  beginLogin: vi.fn(),
  logout: vi.fn(),
  getAccessContext: vi.fn(async () => ({
    headers: { Authorization: 'Bearer token', 'ChatGPT-Account-Id': 'account-1' },
  })),
}

describe('CodexTransportAdapter', () => {
  it('maps messages and streams text into an OpenFox response', async () => {
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect(body['model']).toBe('gpt-5.2-codex')
      expect(body['instructions']).toBe('You are helpful')
      return new Response(
        stream([
          { type: 'response.created', response: { id: 'resp-1' } },
          { type: 'response.output_text.delta', delta: 'Hello ' },
          { type: 'response.output_text.delta', delta: 'world' },
          {
            type: 'response.completed',
            response: { usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } },
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    })
    const transport = new CodexTransportAdapter(auth, {
      endpoint: 'https://codex.test/responses',
      fetch: request as typeof fetch,
    })

    const response = await transport.complete(
      {
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' },
        ],
      },
      { providerId: 'provider-1', credentialRef: 'credential-1', model: 'gpt-5.2-codex' },
    )

    expect(response).toEqual({
      id: 'resp-1',
      content: 'Hello world',
      finishReason: 'stop',
      usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    })
    expect(request).toHaveBeenCalledWith(
      'https://codex.test/responses',
      expect.objectContaining({
        headers: expect.objectContaining({ 'ChatGPT-Account-Id': 'account-1' }),
      }),
    )
  })

  it('maps assistant history to output_text for the Responses API', async () => {
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { input: Array<Record<string, unknown>> }
      expect(body.input).toEqual([
        { role: 'user', content: [{ type: 'input_text', text: 'First question' }] },
        { role: 'assistant', content: [{ type: 'output_text', text: 'First answer' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'Follow-up' }] },
      ])
      return new Response(stream([{ type: 'response.completed', response: { id: 'resp-history' } }]), {
        status: 200,
      })
    })
    const transport = new CodexTransportAdapter(auth, {
      endpoint: 'https://codex.test/responses',
      fetch: request as typeof fetch,
    })

    await transport.complete(
      {
        messages: [
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'First answer' },
          { role: 'user', content: 'Follow-up' },
        ],
      },
      { providerId: 'provider-1', credentialRef: 'credential-1', model: 'gpt-5.4' },
    )
  })

  it('maps function call deltas to tool calls', async () => {
    const request = vi.fn(
      async () =>
        new Response(
          stream([
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: { type: 'function_call', call_id: 'call-1', name: 'read', arguments: '' },
            },
            { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"path":' },
            { type: 'response.function_call_arguments.delta', output_index: 0, delta: '"a.txt"}' },
          ]),
          { status: 200 },
        ),
    )
    const transport = new CodexTransportAdapter(auth, { fetch: request as typeof fetch })

    const response = await transport.complete(
      { messages: [{ role: 'user', content: 'Read file' }] },
      { providerId: 'provider-1', credentialRef: 'credential-1' },
    )

    expect(response.finishReason).toBe('tool_calls')
    expect(response.toolCalls).toEqual([{ id: 'call-1', name: 'read', arguments: { path: 'a.txt' } }])
  })

  it('retries transient Responses Lite WebSocket handshake failures', async () => {
    class MockSocket {
      private listeners = new Map<string, Set<(...args: never[]) => void>>()
      on(name: string, listener: (...args: never[]) => void) {
        const values = this.listeners.get(name) ?? new Set()
        values.add(listener)
        this.listeners.set(name, values)
        return this
      }
      once(name: string, listener: (...args: never[]) => void) {
        const wrapped = ((...args: never[]) => {
          this.off(name, wrapped)
          listener(...args)
        }) as (...args: never[]) => void
        return this.on(name, wrapped)
      }
      off(name: string, listener: (...args: never[]) => void) {
        this.listeners.get(name)?.delete(listener)
        return this
      }
      emit(name: string, ...args: unknown[]) {
        for (const listener of this.listeners.get(name) ?? []) listener(...(args as never[]))
      }
      send(_value: string, callback?: (error?: Error) => void) {
        callback?.()
        queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'response.completed' })), false))
      }
      close() {}
      terminate() {}
    }

    let attempts = 0
    const transport = new CodexTransportAdapter(auth, {
      endpoint: 'https://codex.test/responses',
      websocketFactory: (() => {
        attempts++
        const socket = new MockSocket()
        queueMicrotask(() => {
          if (attempts < 3) {
            const response = new Readable({ read() {} }) as Readable & { statusCode: number }
            response.statusCode = 503
            socket.emit('unexpected-response', {}, response)
            response.push('temporarily unavailable')
            response.push(null)
          } else {
            socket.emit('open')
          }
        })
        return socket
      }) as never,
    })

    await transport.complete(
      { messages: [{ role: 'user', content: 'Hello' }] },
      { providerId: 'provider-1', credentialRef: 'credential-1', model: 'gpt-5.6-luna' },
    )

    expect(attempts).toBe(3)
  })

  it('uses the OpenCode Responses Lite WebSocket protocol for gpt-5.6-luna', async () => {
    class MockSocket extends EventTarget {
      sent: string[] = []
      url = 'wss://codex.test/responses'
      private listeners = new Map<string, Set<(...args: never[]) => void>>()
      on(name: string, listener: (...args: never[]) => void) {
        const values = this.listeners.get(name) ?? new Set()
        values.add(listener)
        this.listeners.set(name, values)
        return this
      }
      once(name: string, listener: (...args: never[]) => void) {
        const wrapped = ((...args: never[]) => {
          this.off(name, wrapped)
          listener(...args)
        }) as (...args: never[]) => void
        return this.on(name, wrapped)
      }
      off(name: string, listener: (...args: never[]) => void) {
        this.listeners.get(name)?.delete(listener)
        return this
      }
      emit(name: string, ...args: unknown[]) {
        for (const listener of this.listeners.get(name) ?? []) listener(...(args as never[]))
      }
      send(value: string, callback?: (error?: Error) => void) {
        this.sent.push(value)
        callback?.()
        queueMicrotask(() => {
          this.emit(
            'message',
            Buffer.from(JSON.stringify({ type: 'response.created', response: { id: 'resp-lite' } })),
            false,
          )
          this.emit(
            'message',
            Buffer.from(JSON.stringify({ type: 'response.output_text.delta', delta: 'Lite works' })),
            false,
          )
          this.emit('message', Buffer.from(JSON.stringify({ type: 'response.completed' })), false)
        })
      }
      close() {}
      terminate() {}
    }
    const socket = new MockSocket()
    let connectionHeaders: Record<string, string> | undefined
    const transport = new CodexTransportAdapter(auth, {
      endpoint: 'https://codex.test/responses',
      websocketFactory: ((url: string, options: { headers?: Record<string, string> }) => {
        expect(url).toBe('wss://codex.test/responses')
        connectionHeaders = options.headers
        queueMicrotask(() => socket.emit('open'))
        return socket
      }) as never,
    })

    const response = await transport.complete(
      {
        messages: [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'Hello' },
        ],
        tools: [
          {
            type: 'function',
            function: { name: 'read', description: 'Read a file', parameters: { type: 'object' } },
          },
        ],
        reasoningEffort: 'high',
        maxTokens: 4096,
      },
      { providerId: 'provider-1', credentialRef: 'credential-1', model: 'gpt-5.6-luna' },
    )

    expect(connectionHeaders).toEqual(
      expect.objectContaining({
        'openai-beta': 'responses_websockets=2026-02-06',
        'x-openai-internal-codex-responses-lite': 'true',
        version: '0.144.0',
      }),
    )
    const sent = JSON.parse(socket.sent[0]!) as Record<string, unknown>
    expect(sent['type']).toBe('response.create')
    expect(sent['model']).toBe('gpt-5.6-luna')
    expect(sent['tools']).toBeUndefined()
    expect(sent['instructions']).toBeUndefined()
    expect(sent['client_metadata']).toEqual({
      ws_request_header_x_openai_internal_codex_responses_lite: 'true',
    })
    expect(response.content).toBe('Lite works')
  })
})
