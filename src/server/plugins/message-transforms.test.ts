import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setPluginMessageTransforms,
  clearPluginMessageTransforms,
  applyPluginMessageTransforms,
} from './message-transforms.js'
import type { ContextMessage } from '../events/folding.js'

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
