import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCodexModelsCache, fetchCodexModels } from './models-dev-catalog.js'

beforeEach(clearCodexModelsCache)

describe('fetchCodexModels', () => {
  it('projects OpenAI base models and models.dev modes using OpenCode-compatible rules', async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            openai: {
              models: {
                sol: {
                  id: 'gpt-5.6-sol',
                  name: 'GPT-5.6 Sol',
                  limit: { context: 1050000, output: 128000 },
                  modalities: { input: ['text', 'image'] },
                  reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }],
                  experimental: {
                    modes: {
                      fast: { provider: { body: { service_tier: 'priority' } } },
                      pro: { provider: { body: { reasoning: { mode: 'pro' } } } },
                    },
                  },
                },
                terra: { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', limit: { context: 1050000 } },
                codex: { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', limit: { context: 400000 } },
                blocked: { id: 'gpt-5.5-pro', limit: { context: 1050000 } },
                unrelated: { id: 'gpt-4.1', limit: { context: 1000000 } },
              },
            },
          }),
          { status: 200 },
        ),
    )

    const models = await fetchCodexModels(request as typeof fetch)

    expect(models.map((model) => model.id)).toEqual([
      'gpt-5.6-terra',
      'gpt-5.6-sol-pro',
      'gpt-5.6-sol-fast',
      'gpt-5.6-sol',
      'gpt-5.3-codex',
    ])
    expect(models.find((model) => model.id === 'gpt-5.6-sol')).toEqual(
      expect.objectContaining({
        name: 'GPT-5.6 Sol',
        apiModelId: 'gpt-5.6-sol',
        contextWindow: 1050000,
        supportsVision: true,
        selected: true,
        defaultMaxTokens: 128000,
        reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      }),
    )
    expect(models.find((model) => model.id === 'gpt-5.6-sol-fast')).toEqual(
      expect.objectContaining({
        name: 'GPT-5.6 Sol Fast',
        apiModelId: 'gpt-5.6-sol',
        requestBody: { service_tier: 'priority' },
      }),
    )
    expect(models.find((model) => model.id === 'gpt-5.6-sol-pro')).toEqual(
      expect.objectContaining({
        name: 'GPT-5.6 Sol Pro',
        apiModelId: 'gpt-5.6-sol',
        requestBody: { reasoning: { mode: 'pro' } },
      }),
    )
  })

  it('caches the catalog for subsequent calls', async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ openai: { models: { codex: { id: 'gpt-5-codex' } } } }), { status: 200 }),
    )

    await fetchCodexModels(request as typeof fetch)
    await fetchCodexModels(request as typeof fetch)

    expect(request).toHaveBeenCalledTimes(1)
  })
})
