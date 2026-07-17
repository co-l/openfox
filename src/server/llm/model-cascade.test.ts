import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMClientWithModel } from './client.js'
import { createCascadingLLMClient, modelCooldownRegistry } from './model-cascade.js'

function client(model: string, events: Array<Record<string, unknown>>, onStream?: () => void): LLMClientWithModel {
  return {
    getModel: () => model,
    setModel: vi.fn(),
    getProfile: vi.fn() as never,
    getBackend: () => 'unknown',
    setBackend: vi.fn(),
    complete: vi.fn(),
    async *stream() {
      onStream?.()
      for (const event of events) yield event as never
    },
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iterable) result.push(item)
  return result
}

describe('model cascade', () => {
  beforeEach(() => modelCooldownRegistry.clear())

  it('falls back before output and keeps priority on the next call', async () => {
    const first = client('first', [{ type: 'error', error: 'busy', metadata: { kind: 'http', status: 429 } }])
    const second = client('second', [
      {
        type: 'done',
        response: {
          id: '2',
          content: 'ok',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      },
    ])
    const cascade = createCascadingLLMClient([
      { providerId: 'a', model: 'first', client: first },
      { providerId: 'b', model: 'second', client: second },
    ])

    const events = await collect(cascade.stream({ messages: [] }))
    expect(events).toEqual([
      {
        type: 'model_cascade_fallback',
        fallback: {
          providerId: 'a',
          providerName: 'a',
          model: 'first',
          error: 'busy',
        },
      },
      expect.objectContaining({ type: 'done' }),
    ])
    expect(modelCooldownRegistry.get('a', 'first')?.kind).toBe('cooldown')
    const secondCall = await collect(cascade.stream({ messages: [] }))
    expect(secondCall.at(-1)?.type).toBe('done')
  })

  it('calls models in exact order and restores the first priority after cooldown expiry', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    let firstFails = true
    const first = client('first', [], () => calls.push('first'))
    first.stream = async function* () {
      calls.push('first')
      if (firstFails) {
        yield { type: 'error', error: 'network', metadata: { kind: 'network' } }
      } else {
        yield {
          type: 'done',
          response: {
            id: '1',
            content: 'first',
            finishReason: 'stop',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          },
        }
      }
    }
    const second = client(
      'second',
      [
        {
          type: 'done',
          response: {
            id: '2',
            content: 'second',
            finishReason: 'stop',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          },
        },
      ],
      () => calls.push('second'),
    )
    const cascade = createCascadingLLMClient([
      { providerId: 'a', model: 'first', client: first },
      { providerId: 'b', model: 'second', client: second },
    ])

    await collect(cascade.stream({ messages: [] }))
    expect(calls).toEqual(['first', 'second'])
    calls.length = 0
    await collect(cascade.stream({ messages: [] }))
    expect(calls).toEqual(['second'])
    vi.advanceTimersByTime(120_001)
    firstFails = false
    calls.length = 0
    await collect(cascade.stream({ messages: [] }))
    expect(calls).toEqual(['first'])
    vi.useRealTimers()
  })

  it('classifies 503 as overload and request-specific 400 and other 5xx as transient', () => {
    vi.useFakeTimers()
    const now = Date.now()
    modelCooldownRegistry.mark('a', 'overload', { kind: 'http', status: 503 })
    modelCooldownRegistry.mark('a', 'bad-request', { kind: 'http', status: 400 })
    modelCooldownRegistry.mark('a', 'server', { kind: 'http', status: 500 })
    expect(modelCooldownRegistry.get('a', 'overload')?.until).toBe(now + 1_200_000)
    expect(modelCooldownRegistry.get('a', 'bad-request')).toMatchObject({
      kind: 'cooldown',
      until: now + 120_000,
    })
    expect(modelCooldownRegistry.get('a', 'server')?.until).toBe(now + 120_000)
    vi.useRealTimers()
  })

  it('preserves each fallback model settings and applies the output limit independently', async () => {
    const requests: Array<{ modelSettings?: { maxTokens?: number; temperature?: number } }> = []
    const first = client('first', [])
    const second = client('second', [])
    first.getModelSettings = () => ({ maxTokens: 1_000, temperature: 0.2 })
    second.getModelSettings = () => ({ maxTokens: 2_000, temperature: 0.4 })
    first.stream = async function* (request) {
      requests.push(request)
      yield { type: 'error', error: 'busy', metadata: { kind: 'network' } }
    }
    second.stream = async function* (request) {
      requests.push(request)
      yield {
        type: 'done',
        response: {
          id: '2',
          content: 'ok',
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      }
    }
    const cascade = createCascadingLLMClient([
      { providerId: 'a', model: 'first', client: first },
      { providerId: 'b', model: 'second', client: second },
    ])

    expect(cascade.getModelSettings?.()).toBeNull()
    await collect(cascade.stream({ messages: [], maxTokensLimit: 1_500 }))
    expect(requests.map((request) => request.modelSettings)).toEqual([
      { maxTokens: 1_000, temperature: 0.2 },
      { maxTokens: 1_500, temperature: 0.4 },
    ])
  })

  it('preserves request-specific settings over each model default', async () => {
    const requests: Array<{ modelSettings?: { maxTokens?: number; temperature?: number } }> = []
    const first = client('first', [{ type: 'error', error: 'busy', metadata: { kind: 'network' } }])
    const second = client('second', [
      {
        type: 'done',
        response: {
          id: '2',
          content: 'ok',
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      },
    ])
    first.getModelSettings = () => ({ maxTokens: 1_000, temperature: 0.2 })
    second.getModelSettings = () => ({ maxTokens: 2_000, temperature: 0.4 })
    first.stream = async function* (request) {
      requests.push(request)
      yield { type: 'error', error: 'busy', metadata: { kind: 'network' } }
    }
    second.stream = async function* (request) {
      requests.push(request)
      yield {
        type: 'done',
        response: {
          id: '2',
          content: 'ok',
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      }
    }
    const cascade = createCascadingLLMClient([
      { providerId: 'a', model: 'first', client: first },
      { providerId: 'b', model: 'second', client: second },
    ])

    await collect(cascade.stream({ messages: [], modelSettings: { maxTokens: 3_000 } }))
    expect(requests.map((request) => request.modelSettings)).toEqual([
      { maxTokens: 3_000, temperature: 0.2 },
      { maxTokens: 3_000, temperature: 0.4 },
    ])
  })

  it('exposes the successful fallback identity for stats attribution', async () => {
    const first = client('first', [{ type: 'error', error: 'busy', metadata: { kind: 'network' } }])
    const second = client('second', [
      {
        type: 'done',
        response: {
          id: '2',
          content: 'ok',
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      },
    ])
    first.getProviderName = () => 'Primary'
    second.getProviderName = () => 'Fallback'
    const cascade = createCascadingLLMClient([
      { providerId: 'a', model: 'first', client: first },
      { providerId: 'b', model: 'second', client: second },
    ])
    await collect(cascade.stream({ messages: [] }))
    expect(cascade.getModel()).toBe('second')
    expect(cascade.getProviderId?.()).toBe('b')
    expect(cascade.getProviderName?.()).toBe('Fallback')
  })

  it('reports each failed model before trying the next one', async () => {
    const first = client('first', [{ type: 'error', error: 'first failed', metadata: { kind: 'network' } }])
    const second = client('second', [{ type: 'error', error: 'second failed', metadata: { kind: 'network' } }])
    const third = client('third', [
      {
        type: 'done',
        response: {
          id: '3',
          content: 'ok',
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      },
    ])
    first.getProviderName = () => 'Primary'
    second.getProviderName = () => 'Secondary'
    const cascade = createCascadingLLMClient([
      { providerId: 'a', model: 'first', client: first },
      { providerId: 'b', model: 'second', client: second },
      { providerId: 'c', model: 'third', client: third },
    ])

    const events = await collect(cascade.stream({ messages: [] }))
    expect(events.filter((event) => event.type === 'model_cascade_fallback')).toEqual([
      {
        type: 'model_cascade_fallback',
        fallback: { providerId: 'a', providerName: 'Primary', model: 'first', error: 'first failed' },
      },
      {
        type: 'model_cascade_fallback',
        fallback: { providerId: 'b', providerName: 'Secondary', model: 'second', error: 'second failed' },
      },
    ])
  })

  it('does not fall back on an abort error', async () => {
    const first = client('first', [{ type: 'error', error: 'aborted', metadata: { kind: 'abort' } }])
    const secondStream = vi.fn()
    const second = client('second', [], secondStream)
    const cascade = createCascadingLLMClient([
      { providerId: 'a', model: 'first', client: first },
      { providerId: 'b', model: 'second', client: second },
    ])

    expect(await collect(cascade.stream({ messages: [] }))).toEqual([
      { type: 'error', error: 'aborted', metadata: { kind: 'abort' } },
    ])
    expect(secondStream).not.toHaveBeenCalled()
  })

  it('does not fall back after a tool-call delta', async () => {
    const first = client('first', [
      { type: 'tool_call_delta', index: 0, name: 'read_file' },
      { type: 'error', error: 'failed', metadata: { kind: 'network' } },
    ])
    const second = client('second', [{ type: 'done', response: {} }])
    const cascade = createCascadingLLMClient([
      { providerId: 'a', model: 'first', client: first },
      { providerId: 'b', model: 'second', client: second },
    ])
    expect((await collect(cascade.stream({ messages: [] }))).map((event) => event.type)).toEqual([
      'tool_call_delta',
      'error',
    ])
  })

  it('does not fall back after visible output', async () => {
    const first = client('first', [
      { type: 'text_delta', content: 'partial' },
      { type: 'error', error: 'failed', metadata: { kind: 'network' } },
    ])
    const second = client('second', [{ type: 'done', response: {} }])
    const cascade = createCascadingLLMClient([
      { providerId: 'a', model: 'first', client: first },
      { providerId: 'b', model: 'second', client: second },
    ])

    const events = await collect(cascade.stream({ messages: [] }))
    expect(events.map((event) => event.type)).toEqual(['text_delta', 'error'])
  })

  it('expires transient cooldowns', () => {
    vi.useFakeTimers()
    modelCooldownRegistry.mark('a', 'network', { kind: 'network' }, 60_000, 2_000)
    expect(modelCooldownRegistry.get('a', 'network')).toBeDefined()
    vi.advanceTimersByTime(2_001)
    expect(modelCooldownRegistry.get('a', 'network')).toBeUndefined()
    vi.useRealTimers()
  })

  it('uses Retry-After and marks configuration errors until cleared', () => {
    const now = Date.now()
    modelCooldownRegistry.mark('a', 'quota', { kind: 'overload', status: 429, retryAfterMs: 30_000 }, 60_000, 2_000)
    const quota = modelCooldownRegistry.get('a', 'quota')
    expect(quota?.until).toBeGreaterThanOrEqual(now + 29_000)
    modelCooldownRegistry.mark('a', 'invalid', { kind: 'http', status: 401 }, 60_000, 2_000)
    expect(modelCooldownRegistry.get('a', 'invalid')).toMatchObject({ kind: 'configuration' })
    modelCooldownRegistry.clearProvider('a')
    expect(modelCooldownRegistry.get('a', 'invalid')).toBeUndefined()
  })

  it('fails immediately and lists every unavailable model with delay or reason', async () => {
    modelCooldownRegistry.mark('a', 'first', { kind: 'http', status: 429 }, 60_000, 2_000)
    modelCooldownRegistry.mark('b', 'second', { kind: 'http', status: 401 }, 60_000, 2_000)
    const first = client('first', [])
    const second = client('second', [])
    const cascade = createCascadingLLMClient([
      { providerId: 'a', model: 'first', client: first },
      { providerId: 'b', model: 'second', client: second },
    ])
    const events = await collect(cascade.stream({ messages: [] }))
    expect(events[0]).toMatchObject({ type: 'error' })
    const error = (events[0] as { error: string }).error
    expect(error).toContain('a/first: 60s remaining')
    expect(error).toContain('b/second: HTTP 401; unavailable until provider configuration changes')
  })
})
