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
})
