import { afterEach, describe, expect, it, vi } from 'vitest'
import { LLMError } from '../utils/errors.js'
import { OpenAIHttpClient } from './http-client.js'

const params = { model: 'test', messages: [], stream: false } as never

describe('OpenAIHttpClient Retry-After', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses Retry-After seconds into structured error metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('busy', { status: 429, headers: { 'Retry-After': '30' } })),
    )
    const client = new OpenAIHttpClient({ baseURL: 'http://localhost/v1', apiKey: 'key' })
    const error = await client.createChatCompletion(params).catch((caught) => caught)
    expect(error).toBeInstanceOf(LLMError)
    expect((error as LLMError).details).toMatchObject({ kind: 'overload', status: 429, retryAfterMs: 30_000 })
  })

  it('ignores invalid Retry-After values so the configured default is used', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('busy', { status: 503, headers: { 'Retry-After': 'invalid' } })),
    )
    const client = new OpenAIHttpClient({ baseURL: 'http://localhost/v1', apiKey: 'key' })
    const error = await client.createChatCompletion(params).catch((caught) => caught)
    expect((error as LLMError).details).toMatchObject({ kind: 'overload', status: 503 })
    expect((error as LLMError).details).not.toHaveProperty('retryAfterMs')
  })
})
