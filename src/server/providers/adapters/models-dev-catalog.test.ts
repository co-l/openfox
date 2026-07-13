import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCodexModelsCache, fetchCodexModels } from './models-dev-catalog.js'

beforeEach(clearCodexModelsCache)

describe('fetchCodexModels', () => {
  it('filters the OpenAI catalog using OpenCode-compatible rules', async () => {
    const request = vi.fn(async () =>
      new Response(
        JSON.stringify({
          openai: {
            models: {
              codex: {
                id: 'gpt-5.3-codex',
                limit: { context: 400000, output: 128000 },
                modalities: { input: ['text', 'image'] },
              },
              allowed: { id: 'gpt-5.4', limit: { context: 1050000 } },
              luna: { id: 'gpt-5.6-luna', limit: { context: 1050000 } },
              blocked: { id: 'gpt-5.5-pro', limit: { context: 1050000 } },
              unrelated: { id: 'gpt-4.1', limit: { context: 1000000 } },
            },
          },
        }),
        { status: 200 },
      ),
    )

    const models = await fetchCodexModels(request as typeof fetch)

    expect(models.map((model) => model.id)).toEqual(['gpt-5.4', 'gpt-5.3-codex'])
    expect(models.find((model) => model.id === 'gpt-5.3-codex')).toEqual(
      expect.objectContaining({ contextWindow: 400000, supportsVision: true, defaultMaxTokens: 128000 }),
    )
  })

  it('caches the catalog for subsequent calls', async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ openai: { models: { codex: { id: 'gpt-5-codex' } } } }), { status: 200 }),
    )

    await fetchCodexModels(request as typeof fetch)
    await fetchCodexModels(request as typeof fetch)

    expect(request).toHaveBeenCalledTimes(1)
  })
})
