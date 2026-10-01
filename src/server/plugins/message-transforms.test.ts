import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setPluginMessageTransforms,
  clearPluginMessageTransforms,
  applyPluginMessageTransforms,
} from './message-transforms.js'
import type { ContextMessage } from '../events/folding.js'
import type { PluginMessageTransform } from '../../plugin/index.js'

describe('message-transforms', () => {
  beforeEach(() => {
    clearPluginMessageTransforms()
    vi.clearAllMocks()
  })

  it('returns original messages when no transforms are registered', async () => {
    const messages: ContextMessage[] = [{ role: 'user', content: 'hello' }]
    const result = await applyPluginMessageTransforms(messages, {
      sessionId: 's1',
      workdir: '/tmp',
      model: 'gpt-4o',
      systemPrompt: 'sys prompt',
    })

    expect(result.messages).toEqual(messages)
    expect(result.systemPrompt).toBe('sys prompt')
    expect(result.metadata).toEqual({})
  })

  it('executes transforms in ascending priority order', async () => {
    const executionOrder: string[] = []

    setPluginMessageTransforms([
      {
        pluginId: 'plugin-b',
        transform: {
          id: 'transform-b',
          priority: 200,
          transform: (msgs) => {
            executionOrder.push('b')
            return msgs.map((m) => ({ ...m, content: `${m.content} -> b` }))
          },
        },
      },
      {
        pluginId: 'plugin-a',
        transform: {
          id: 'transform-a',
          priority: 50,
          transform: (msgs) => {
            executionOrder.push('a')
            return msgs.map((m) => ({ ...m, content: `${m.content} -> a` }))
          },
        },
      },
      {
        pluginId: 'plugin-c',
        transform: {
          id: 'transform-c',
          priority: 100,
          transform: (msgs) => {
            executionOrder.push('c')
            return msgs.map((m) => ({ ...m, content: `${m.content} -> c` }))
          },
        },
      },
    ])

    const messages: ContextMessage[] = [{ role: 'user', content: 'init' }]
    const result = await applyPluginMessageTransforms(messages, {
      sessionId: 's1',
      workdir: '/tmp',
      model: 'gpt-4o',
      systemPrompt: 'sys prompt',
    })

    expect(executionOrder).toEqual(['a', 'c', 'b'])
    expect(result.messages[0]?.content).toBe('init -> a -> c -> b')
  })

  it('supports modifying systemPrompt and accumulating metadata', async () => {
    setPluginMessageTransforms([
      {
        pluginId: 'compressor-plugin',
        transform: {
          id: 'compressor',
          transform: () => ({
            messages: [{ role: 'user', content: 'compressed user' }],
            systemPrompt: 'compressed system prompt',
            metadata: { tokensSaved: 120, algorithm: 'smart_crush' },
          }),
        },
      },
      {
        pluginId: 'analytics-plugin',
        transform: {
          id: 'analytics',
          priority: 200,
          transform: (_msgs, context) => {
            expect(context.systemPrompt).toBe('compressed system prompt')
            return {
              messages: _msgs,
              metadata: { inspected: true },
            }
          },
        },
      },
    ])

    const result = await applyPluginMessageTransforms([{ role: 'user', content: 'raw prompt' }], {
      sessionId: 's1',
      workdir: '/tmp',
      model: 'gpt-4o',
      systemPrompt: 'original system prompt',
    })

    expect(result.messages[0]?.content).toBe('compressed user')
    expect(result.systemPrompt).toBe('compressed system prompt')
    expect(result.metadata).toEqual({
      tokensSaved: 120,
      algorithm: 'smart_crush',
      inspected: true,
    })
  })

  it('fails open when a transform throws an error', async () => {
    setPluginMessageTransforms([
      {
        pluginId: 'buggy-plugin',
        transform: {
          id: 'buggy',
          transform: () => {
            throw new Error('Connection refused to compression service')
          },
        },
      },
      {
        pluginId: 'good-plugin',
        transform: {
          id: 'good',
          priority: 200,
          transform: (msgs) => msgs.map((m) => ({ ...m, content: `${m.content} [processed]` })),
        },
      },
    ])

    const messages: ContextMessage[] = [{ role: 'user', content: 'original' }]
    const result = await applyPluginMessageTransforms(messages, {
      sessionId: 's1',
      workdir: '/tmp',
      model: 'gpt-4o',
      systemPrompt: 'sys',
    })

    // The buggy transform is skipped fail-open, the good transform still runs
    expect(result.messages[0]?.content).toBe('original [processed]')
  })

  it('fails open when a transform times out', async () => {
    setPluginMessageTransforms([
      {
        pluginId: 'hanging-plugin',
        transform: {
          id: 'hanging',
          transform: async () => {
            await new Promise((resolve) => setTimeout(resolve, 500))
            return [{ role: 'user', content: 'should never happen' }]
          },
        },
      },
    ])

    const messages: ContextMessage[] = [{ role: 'user', content: 'original' }]
    const result = await applyPluginMessageTransforms(
      messages,
      {
        sessionId: 's1',
        workdir: '/tmp',
        model: 'gpt-4o',
        systemPrompt: 'sys',
      },
      { timeoutMs: 50 },
    )

    expect(result.messages[0]?.content).toBe('original')
  })

  it('discards in-place mutations when a transform throws', async () => {
    setPluginMessageTransforms([
      {
        pluginId: 'mutating-thrower',
        transform: {
          id: 'mutating-thrower',
          transform: (msgs) => {
            ;(msgs as unknown as ContextMessage[]).push({ role: 'assistant', content: 'injected' })
            const first = msgs[0] as unknown as ContextMessage
            first.content = 'corrupted'
            first.thinkingContent = 'corrupted thinking'
            first.toolCalls = [{ id: 't1', name: 'read', arguments: { path: '/etc/passwd' } }]
            first.attachments = [
              {
                id: 'a1',
                filename: 'a.txt',
                mimeType: 'text/plain',
                size: 1,
                data: 'x',
              },
            ]
            throw new Error('boom after mutation')
          },
        },
      },
    ])

    const messages: ContextMessage[] = [{ role: 'user', content: 'original' }]
    const result = await applyPluginMessageTransforms(messages, {
      sessionId: 's1',
      workdir: '/tmp',
      model: 'gpt-4o',
      systemPrompt: 'sys',
    })

    expect(result.messages).toEqual([{ role: 'user', content: 'original' }])
  })

  it('leaves the caller-provided messages array untouched when a transform mutates and fails', async () => {
    setPluginMessageTransforms([
      {
        pluginId: 'mutating-thrower',
        transform: {
          id: 'mutating-thrower',
          transform: (msgs) => {
            const list = msgs as unknown as ContextMessage[]
            list.push({ role: 'assistant', content: 'injected' })
            ;(list[0] as ContextMessage).content = 'corrupted'
            throw new Error('boom')
          },
        },
      },
    ])

    const messages: ContextMessage[] = [{ role: 'user', content: 'original' }]
    await applyPluginMessageTransforms(messages, {
      sessionId: 's1',
      workdir: '/tmp',
      model: 'gpt-4o',
      systemPrompt: 'sys',
    })

    expect(messages).toEqual([{ role: 'user', content: 'original' }])
  })

  it('discards in-place mutations when a transform times out', async () => {
    setPluginMessageTransforms([
      {
        pluginId: 'hanging-mutator',
        transform: {
          id: 'hanging-mutator',
          transform: async (msgs) => {
            const list = msgs as unknown as ContextMessage[]
            list.push({ role: 'assistant', content: 'injected' })
            ;(list[0] as ContextMessage).content = 'corrupted'
            await new Promise((resolve) => setTimeout(resolve, 200))
            return list
          },
        },
      },
    ])

    const messages: ContextMessage[] = [{ role: 'user', content: 'original' }]
    const result = await applyPluginMessageTransforms(
      messages,
      {
        sessionId: 's1',
        workdir: '/tmp',
        model: 'gpt-4o',
        systemPrompt: 'sys',
      },
      { timeoutMs: 20 },
    )

    expect(result.messages).toEqual([{ role: 'user', content: 'original' }])
  })

  it('ignores mutations performed after a transform already timed out', async () => {
    let abandoned: ContextMessage[] | undefined
    let lateMutationDone: () => void = () => {}
    const lateMutationHappened = new Promise<void>((resolve) => {
      lateMutationDone = resolve
    })

    setPluginMessageTransforms([
      {
        pluginId: 'late-mutator',
        transform: {
          id: 'late-mutator',
          transform: async (msgs) => {
            const list = msgs as unknown as ContextMessage[]
            abandoned = list
            // Timed out here; the mutations below happen long after the host
            // already fell back to the original messages.
            await new Promise((resolve) => setTimeout(resolve, 60))
            list.push({ role: 'assistant', content: 'late injection' })
            ;(list[0] as ContextMessage).content = 'late corruption'
            lateMutationDone()
            return list
          },
        },
      },
    ])

    const messages: ContextMessage[] = [{ role: 'user', content: 'original' }]
    const result = await applyPluginMessageTransforms(
      messages,
      {
        sessionId: 's1',
        workdir: '/tmp',
        model: 'gpt-4o',
        systemPrompt: 'sys',
      },
      { timeoutMs: 20 },
    )

    await lateMutationHappened

    expect(abandoned).toBeDefined()
    expect(result.messages).toEqual([{ role: 'user', content: 'original' }])
    expect(messages).toEqual([{ role: 'user', content: 'original' }])
  })

  it('keeps the last successful systemPrompt when a later transform mutates its context and throws', async () => {
    setPluginMessageTransforms([
      {
        pluginId: 'ctx-writer',
        transform: {
          id: 'ctx-writer',
          transform: (msgs, context) => {
            const mutable = context as unknown as Record<string, unknown>
            mutable['systemPrompt'] = 'poisoned system prompt'
            mutable['model'] = 'poisoned-model'
            return { messages: msgs, systemPrompt: 'poisoned system prompt' }
          },
        },
      },
      {
        pluginId: 'ctx-thrower',
        transform: {
          id: 'ctx-thrower',
          priority: 50,
          transform: (_msgs, context) => {
            const mutable = context as unknown as Record<string, unknown>
            mutable['systemPrompt'] = 'poisoned too'
            throw new Error('boom')
          },
        },
      },
    ])

    const context = {
      sessionId: 's1',
      workdir: '/tmp',
      model: 'gpt-4o',
      systemPrompt: 'sys',
    }
    const result = await applyPluginMessageTransforms([{ role: 'user', content: 'original' }], context)

    expect(result.systemPrompt).toBe('poisoned system prompt')
    expect(result.messages[0]?.content).toBe('original')
    expect(context.model).toBe('gpt-4o')
    expect(context.systemPrompt).toBe('sys')
  })

  it('adopts in-place edits from a transform that returns no value, without leaking its reference', async () => {
    let retained: ContextMessage[] | undefined

    setPluginMessageTransforms([
      {
        pluginId: 'in-place-only',
        transform: {
          id: 'in-place-only',
          transform: (msgs) => {
            const list = msgs as unknown as ContextMessage[]
            list.push({ role: 'assistant', content: 'appended in place' })
            ;(list[0] as ContextMessage).content = 'edited in place'
            retained = list
            // A transform may edit the list it was given and return nothing.
            // `PluginMessageTransformResult` requires `messages`, so this
            // untyped-JS shape a plugin can still write is produced by a cast.
            return undefined as unknown as ReturnType<PluginMessageTransform['transform']>
          },
        },
      },
    ])

    const messages: ContextMessage[] = [{ role: 'user', content: 'original' }]
    const result = await applyPluginMessageTransforms(messages, {
      sessionId: 's1',
      workdir: '/tmp',
      model: 'gpt-4o',
      systemPrompt: 'sys',
    })

    expect(result.messages).toEqual([
      { role: 'user', content: 'edited in place' },
      { role: 'assistant', content: 'appended in place' },
    ])
    expect(result.systemPrompt).toBe('sys')

    // The plugin still holds the array it was given: it must not be able to
    // mutate the messages the host is about to send.
    retained?.push({ role: 'user', content: 'late injection' })
    ;(retained?.[0] as ContextMessage).content = 'late corruption'

    expect(result.messages).toEqual([
      { role: 'user', content: 'edited in place' },
      { role: 'assistant', content: 'appended in place' },
    ])
  })

  it('preserves Dates, Maps and cyclic metadata instead of flattening them', async () => {
    setPluginMessageTransforms([
      {
        pluginId: 'rich-metadata',
        transform: {
          id: 'rich-metadata',
          transform: (msgs) => {
            const cyclic: Record<string, unknown> = { name: 'root' }
            cyclic['self'] = cyclic
            return {
              messages: msgs as never,
              metadata: {
                generatedAt: new Date('2024-01-02T03:04:05.000Z'),
                counters: new Map([['tokens', 42]]),
                cyclic,
              },
            }
          },
        },
      },
      {
        pluginId: 'rich-metadata-sibling',
        transform: {
          id: 'rich-metadata-sibling',
          priority: 200,
          transform: (_msgs) => ({ messages: _msgs }),
        },
      },
    ])

    const result = await applyPluginMessageTransforms([{ role: 'user', content: 'original' }], {
      sessionId: 's1',
      workdir: '/tmp',
      model: 'gpt-4o',
      systemPrompt: 'sys',
    })

    const generatedAt = result.metadata['generatedAt']
    const counters = result.metadata['counters']
    const cyclic = result.metadata['cyclic'] as Record<string, unknown> | undefined

    expect(generatedAt).toBeInstanceOf(Date)
    expect((generatedAt as Date).toISOString()).toBe('2024-01-02T03:04:05.000Z')
    expect(counters).toBeInstanceOf(Map)
    expect((counters as Map<string, number>).get('tokens')).toBe(42)
    expect(cyclic?.['self']).toBe(cyclic)
  })

  it('gives the host a full deep copy of a returned message, including nested values', async () => {
    let returned: ContextMessage[] | undefined

    setPluginMessageTransforms([
      {
        pluginId: 'nested-owner',
        transform: {
          id: 'nested-owner',
          transform: () => {
            returned = [
              {
                role: 'user',
                content: 'host owned',
                toolCalls: [{ id: 't1', name: 'read', arguments: { path: '/tmp/a' } }],
                attachments: [{ id: 'a1', filename: 'a.txt', mimeType: 'text/plain', size: 1, data: 'x' }],
              } as unknown as ContextMessage,
            ]
            return returned
          },
        },
      },
    ])

    const result = await applyPluginMessageTransforms([{ role: 'user', content: 'original' }], {
      sessionId: 's1',
      workdir: '/tmp',
      model: 'gpt-4o',
      systemPrompt: 'sys',
    })

    const adopted = result.messages[0]
    ;(returned?.[0] as unknown as { content: string }).content = 'late corruption'
    const returnedToolCall = returned?.[0]?.toolCalls?.[0]
    if (returnedToolCall) returnedToolCall.arguments['path'] = '/etc/passwd'
    const returnedAttachment = returned?.[0]?.attachments?.[0]
    if (returnedAttachment) returnedAttachment.data = 'poisoned'

    expect(adopted?.content).toBe('host owned')
    expect(adopted?.toolCalls?.[0]?.arguments['path']).toBe('/tmp/a')
    expect(adopted?.attachments?.[0]?.data).toBe('x')
    expect(result.messages[0]).not.toBe(returned?.[0])
  })

  it('applies nothing from a transform whose metadata cannot be cloned', async () => {
    setPluginMessageTransforms([
      {
        pluginId: 'good-first',
        transform: {
          id: 'good-first',
          transform: (msgs) => ({
            messages: msgs,
            systemPrompt: 'last successful system prompt',
            metadata: { tokensSaved: 10 },
          }),
        },
      },
      {
        pluginId: 'unclonable-metadata',
        transform: {
          id: 'unclonable-metadata',
          priority: 200,
          transform: () => ({
            messages: [{ role: 'user' as const, content: 'must not be adopted' }],
            systemPrompt: 'must not be adopted',
            metadata: { onDone: () => undefined } as unknown as Record<string, unknown>,
          }),
        },
      },
      {
        pluginId: 'after-failure',
        transform: {
          id: 'after-failure',
          priority: 300,
          transform: (msgs) => msgs.map((m) => ({ ...m, content: `${m.content} [after]` })),
        },
      },
    ])

    const result = await applyPluginMessageTransforms([{ role: 'user', content: 'original' }], {
      sessionId: 's1',
      workdir: '/tmp',
      model: 'gpt-4o',
      systemPrompt: 'sys',
    })

    // The failing transform contributes nothing — not its messages, not its
    // system prompt, not its metadata — and the pipeline keeps going.
    expect(result.messages[0]?.content).toBe('original [after]')
    expect(result.systemPrompt).toBe('last successful system prompt')
    expect(result.metadata).toEqual({ tokensSaved: 10 })
  })

  it('stops transform pipeline immediately when AbortSignal is aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const transformFn = vi.fn()
    setPluginMessageTransforms([
      {
        pluginId: 'p1',
        transform: { id: 't1', transform: transformFn },
      },
    ])

    const messages: ContextMessage[] = [{ role: 'user', content: 'hello' }]
    const result = await applyPluginMessageTransforms(messages, {
      sessionId: 's1',
      workdir: '/tmp',
      model: 'gpt-4o',
      systemPrompt: 'sys',
      signal: controller.signal,
    })

    expect(transformFn).not.toHaveBeenCalled()
    expect(result.messages).toEqual(messages)
  })
})
