import { describe, expect, it, vi } from 'vitest'
import type { Provider } from '../../../shared/types.js'
import { createTransportLLMClient } from './transport-client.js'
import type { ProviderTransportAdapter } from './types.js'

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
      name: 'ChatGPT',
      url: 'https://chatgpt.com/backend-api/codex',
      backend: 'openai',
      models: [{ id: 'gpt-5.4', contextWindow: 1_050_000, source: 'backend', defaultMaxTokens: 128_000, supportsVision: true }],
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    const client = createTransportLLMClient(provider, 'gpt-5.4', transport)
    expect(client.getProfile()).toEqual(expect.objectContaining({ defaultMaxTokens: 128_000, supportsVision: true }))
  })
})
