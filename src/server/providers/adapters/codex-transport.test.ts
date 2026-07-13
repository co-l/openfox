import { describe, expect, it, vi } from 'vitest'
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
})
