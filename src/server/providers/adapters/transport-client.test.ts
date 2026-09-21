import { describe, expect, it, vi } from 'vitest'
import type { Provider } from '../../../shared/types.js'
import { createTransportLLMClient } from './transport-client.js'
import type { ProviderTransportAdapter } from '../../../provider/index.js'

const transport: ProviderTransportAdapter = {
  id: 'test',
  listModels: vi.fn(),
  complete: vi.fn(),
  stream: vi.fn(),
}

describe('createTransportLLMClient', () => {
  it('uses catalog model defaults for the transport profile', () => {
    const provider: Provider = {
      id: 'openai',
      name: 'External Provider',
      url: 'https://provider.example/v1',
      backend: 'openai',
      models: [
        { id: 'gpt-5.4', contextWindow: 1_050_000, source: 'backend', defaultMaxTokens: 128_000, supportsVision: true },
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    const client = createTransportLLMClient(provider, 'gpt-5.4', transport)
    expect(client.getProfile()).toEqual(expect.objectContaining({ defaultMaxTokens: 128_000, supportsVision: true }))
  })

  it('uses the API model id and mode request body while retaining the catalog model id', async () => {
    const provider: Provider = {
      id: 'openai',
      name: 'External Provider',
      url: 'https://provider.example/v1',
      backend: 'openai',
      credentialRef: 'credential',
      models: [
        {
          id: 'gpt-5.6-sol-fast',
          name: 'GPT-5.6 Sol Fast',
          apiModelId: 'gpt-5.6-sol',
          requestBody: { service_tier: 'priority' },
          contextWindow: 1_050_000,
          source: 'backend',
        },
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    const stream = vi.fn(async function* () {
      yield { type: 'done', response: undefined } as never
    })
    const modeTransport: ProviderTransportAdapter = { ...transport, stream }
    const client = createTransportLLMClient(provider, 'gpt-5.6-sol-fast', modeTransport)

    for await (const _event of client.stream({ messages: [] })) {
      // consume stream
    }

    expect(client.getModel()).toBe('gpt-5.6-sol-fast')
    expect(stream).toHaveBeenCalledWith(
      { messages: [] },
      {
        providerId: 'openai',
        model: 'gpt-5.6-sol',
        catalogModel: 'gpt-5.6-sol-fast',
        requestBody: { service_tier: 'priority' },
        credentialRef: 'credential',
      },
    )
  })

  it('resolves attachments before passing messages to the transport', async () => {
    const provider: Provider = {
      id: 'copilot',
      name: 'GitHub Copilot',
      url: 'https://api.githubcopilot.com',
      backend: 'openai',
      credentialRef: 'cred',
      models: [{ id: 'gpt-4o', contextWindow: 128000, source: 'backend' }],
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    const capturedMessages: unknown[] = []
    const mockStream = vi.fn(async function* (request: { messages: unknown[] }) {
      capturedMessages.push(...request.messages)
      yield { type: 'done', response: undefined } as never
    })
    const mockTransport: ProviderTransportAdapter = { ...transport, stream: mockStream }
    const client = createTransportLLMClient(provider, 'gpt-4o', mockTransport)

    for await (const _event of client.stream({
      messages: [
        {
          role: 'user',
          content: 'read this file',
          attachments: [
            {
              id: 'f1',
              filename: 'hello.ts',
              mimeType: 'text/plain',
              size: 20,
              data: 'const x = 1',
            },
          ],
        },
      ],
    })) {
      // consume
    }

    expect(capturedMessages).toHaveLength(1)
    const msg = capturedMessages[0] as { content: string; attachments?: unknown[] }
    expect(msg.content).toContain('hello.ts')
    expect(msg.content).toContain('const x = 1')
    expect(msg.attachments).toEqual([])
  })

  it('resolves attachments before passing messages to complete()', async () => {
    const provider: Provider = {
      id: 'copilot',
      name: 'GitHub Copilot',
      url: 'https://api.githubcopilot.com',
      backend: 'openai',
      credentialRef: 'cred',
      models: [{ id: 'gpt-4o', contextWindow: 128000, source: 'backend' }],
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    const capturedMessages: unknown[] = []
    const mockComplete = vi.fn(async (request: { messages: unknown[] }) => {
      capturedMessages.push(...request.messages)
      return {
        id: 'r1',
        content: '',
        toolCalls: [],
        finishReason: 'stop' as const,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }
    })
    const client = createTransportLLMClient(provider, 'gpt-4o', { ...transport, complete: mockComplete })

    await client.complete({
      messages: [
        {
          role: 'user',
          content: 'read this file',
          attachments: [{ id: 'f2', filename: 'hello.ts', mimeType: 'text/plain', size: 20, data: 'const x = 1' }],
        },
      ],
    })

    expect(capturedMessages).toHaveLength(1)
    const msg = capturedMessages[0] as { content: string; attachments?: unknown[] }
    expect(msg.content).toContain('hello.ts')
    expect(msg.content).toContain('const x = 1')
    expect(msg.attachments).toEqual([])
  })

  it('respects modelSettings.supportsVision override in stream', async () => {
    const provider: Provider = {
      id: 'copilot',
      name: 'GitHub Copilot',
      url: 'https://api.githubcopilot.com',
      backend: 'openai',
      models: [{ id: 'gpt-4o', contextWindow: 128000, source: 'backend', supportsVision: false }],
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    const capturedMessages: unknown[] = []
    const mockStream = vi.fn(async function* (request: { messages: unknown[] }) {
      capturedMessages.push(...request.messages)
      yield { type: 'done', response: undefined } as never
    })
    const client = createTransportLLMClient(provider, 'gpt-4o', { ...transport, stream: mockStream })

    for await (const _event of client.stream({
      messages: [
        {
          role: 'user',
          content: 'look',
          attachments: [
            { id: 'i1', filename: 'photo.png', mimeType: 'image/png', size: 10, data: 'data:image/png;base64,abc' },
          ],
        },
      ],
      modelSettings: { supportsVision: true },
    })) {
      // consume stream
    }

    const msg = capturedMessages[0] as { attachments?: unknown[] }
    expect(msg.attachments).toHaveLength(1)
  })

  it('respects modelSettings.supportsVision override in complete', async () => {
    const provider: Provider = {
      id: 'copilot',
      name: 'GitHub Copilot',
      url: 'https://api.githubcopilot.com',
      backend: 'openai',
      models: [{ id: 'gpt-4o', contextWindow: 128000, source: 'backend', supportsVision: false }],
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    const capturedMessages: unknown[] = []
    const mockComplete = vi.fn(async (request: { messages: unknown[] }) => {
      capturedMessages.push(...request.messages)
      return {
        id: 'r1',
        content: '',
        toolCalls: [],
        finishReason: 'stop' as const,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }
    })
    const client = createTransportLLMClient(provider, 'gpt-4o', { ...transport, complete: mockComplete })

    await client.complete({
      messages: [
        {
          role: 'user',
          content: 'look',
          attachments: [
            { id: 'i1', filename: 'photo.png', mimeType: 'image/png', size: 10, data: 'data:image/png;base64,abc' },
          ],
        },
      ],
      modelSettings: { supportsVision: true },
    })

    const msg = capturedMessages[0] as { attachments?: unknown[] }
    expect(msg.attachments).toHaveLength(1)
  })

  it('threads the client reasoningEffort into complete and getReasoningEffort', async () => {
    const provider: Provider = {
      id: 'openai',
      name: 'External Provider',
      url: 'https://provider.example/v1',
      backend: 'openai',
      models: [{ id: 'gpt-5', contextWindow: 1_050_000, source: 'backend' }],
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    const mockComplete = vi.fn(async () => ({
      id: 'r1',
      content: '',
      toolCalls: [],
      finishReason: 'stop' as const,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }))
    const client = createTransportLLMClient(provider, 'gpt-5', { ...transport, complete: mockComplete }, 'high')

    expect(client.getReasoningEffort?.()).toBe('high')
    await client.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: 'high', messages: [{ role: 'user', content: 'hi' }] }),
      expect.anything(),
    )
  })

  it('threads the client reasoningEffort into stream', async () => {
    const provider: Provider = {
      id: 'openai',
      name: 'External Provider',
      url: 'https://provider.example/v1',
      backend: 'openai',
      models: [{ id: 'gpt-5', contextWindow: 1_050_000, source: 'backend' }],
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    const mockStream = vi.fn(async function* () {
      yield { type: 'done', response: undefined } as never
    })
    const client = createTransportLLMClient(provider, 'gpt-5', { ...transport, stream: mockStream }, 'max')

    for await (const _event of client.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      // consume stream
    }

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: 'max', messages: [{ role: 'user', content: 'hi' }] }),
      expect.anything(),
    )
  })

  it('lets an explicit request effort win over the client effort and skips it when requested', async () => {
    const provider: Provider = {
      id: 'openai',
      name: 'External Provider',
      url: 'https://provider.example/v1',
      backend: 'openai',
      models: [{ id: 'gpt-5', contextWindow: 1_050_000, source: 'backend' }],
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    const mockComplete = vi.fn(async () => ({
      id: 'r1',
      content: '',
      toolCalls: [],
      finishReason: 'stop' as const,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }))
    const client = createTransportLLMClient(provider, 'gpt-5', { ...transport, complete: mockComplete }, 'high')

    await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      reasoningEffort: 'low',
    })
    expect(mockComplete).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: 'low' }), expect.anything())

    await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      skipClientReasoningEffort: true,
    })
    expect(mockComplete).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ reasoningEffort: expect.anything() }),
      expect.anything(),
    )
  })

  it('falls back to the model thinkingLevel when no client effort is set', () => {
    const provider: Provider = {
      id: 'openai',
      name: 'External Provider',
      url: 'https://provider.example/v1',
      backend: 'openai',
      models: [
        { id: 'gpt-5', contextWindow: 1_050_000, source: 'backend', thinkingEnabled: true, thinkingLevel: 'medium' },
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    const client = createTransportLLMClient(provider, 'gpt-5', transport)
    expect(client.getReasoningEffort?.()).toBe('medium')
  })

  it('uses the reasoningEffortOverride as the model default (never clamped)', () => {
    const provider: Provider = {
      id: 'openai',
      name: 'External Provider',
      url: 'https://provider.example/v1',
      backend: 'openai',
      models: [
        {
          id: 'gpt-5',
          contextWindow: 1_050_000,
          source: 'backend',
          thinkingEnabled: true,
          thinkingLevel: 'medium',
          reasoningEffortOverride: 'deep',
          reasoningEfforts: ['low', 'medium', 'high'],
        },
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    const client = createTransportLLMClient(provider, 'gpt-5', transport)
    // The override is the escape hatch — sent verbatim even though it is not in
    // the model's advertised preset list.
    expect(client.getReasoningEffort?.()).toBe('deep')
  })

  it('sanitizes tool schemas before passing to complete() and stream()', async () => {
    const provider: Provider = {
      id: 'copilot',
      name: 'GitHub Copilot',
      url: 'https://api.githubcopilot.com',
      backend: 'openai',
      models: [{ id: 'gpt-4o', contextWindow: 128000, source: 'backend' }],
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    let capturedTools: unknown[] = []
    const mockComplete = vi.fn(async (request: { tools?: unknown[] }) => {
      capturedTools = request.tools ?? []
      return {
        id: 'r1',
        content: '',
        toolCalls: [],
        finishReason: 'stop' as const,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }
    })
    const client = createTransportLLMClient(provider, 'gpt-4o', { ...transport, complete: mockComplete })

    await client.complete({
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                opt: { type: 'string', default: null },
              },
            },
          },
        },
      ],
    })

    expect(capturedTools).toEqual([
      {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {
              opt: { type: 'string' },
            },
          },
        },
      },
    ])
  })

  it('passes an in-list client effort through unchanged', () => {
    const provider: Provider = {
      id: 'openai',
      name: 'External Provider',
      url: 'https://provider.example/v1',
      backend: 'openai',
      models: [
        { id: 'gpt-5', contextWindow: 1_050_000, source: 'backend', reasoningEfforts: ['low', 'medium', 'high'] },
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    const client = createTransportLLMClient(provider, 'gpt-5', transport, 'high')
    expect(client.getReasoningEffort?.()).toBe('high')
  })

  it('clamps an out-of-list client effort to the model default', () => {
    const provider: Provider = {
      id: 'openai',
      name: 'External Provider',
      url: 'https://provider.example/v1',
      backend: 'openai',
      models: [
        {
          id: 'gpt-5',
          contextWindow: 1_050_000,
          source: 'backend',
          thinkingEnabled: true,
          thinkingLevel: 'medium',
          reasoningEfforts: ['low', 'medium', 'high'],
        },
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    const client = createTransportLLMClient(provider, 'gpt-5', transport, 'max')
    expect(client.getReasoningEffort?.()).toBe('medium')
  })

  it('sends no effort for a model with a preset list but no default and no explicit effort', () => {
    const provider: Provider = {
      id: 'openai',
      name: 'External Provider',
      url: 'https://provider.example/v1',
      backend: 'openai',
      models: [
        { id: 'gpt-5', contextWindow: 1_050_000, source: 'backend', reasoningEfforts: ['low', 'medium', 'high'] },
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    const client = createTransportLLMClient(provider, 'gpt-5', transport)
    expect(client.getReasoningEffort?.()).toBeUndefined()
  })
})
