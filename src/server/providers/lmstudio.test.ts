/**
 * The three shapes LM Studio's native model endpoint has been seen returning.
 *
 * The `{ models: [...] }` case is the one that mattered: it is what LM Studio 0.3.x returns, and
 * the copy of this parsing that lived in `auto-config.ts` assumed a bare array and threw on it.
 * Auto-config caught the throw, fell back to a `'default'` context window, and the UI ignores a
 * `'default'` — so the button silently did nothing for the field a user pressed it for.
 */

import { describe, it, expect } from 'vitest'
import { findLmStudioModel, parseLmStudioModels } from './lmstudio.js'

/** A response in the shape LM Studio 0.3.x returns, trimmed to the fields the parser reads. */
const WRAPPED_IN_MODELS = {
  models: [
    {
      type: 'llm',
      key: 'lfm2.5-2.6b',
      max_context_length: 128000,
      loaded_instances: [{ id: 'lfm2.5-2.6b', config: { context_length: 128000 } }],
      capabilities: { vision: false },
    },
    {
      type: 'llm',
      key: 'zai-org/glm-4.6v-flash',
      max_context_length: 131072,
      capabilities: { vision: true },
    },
  ],
}

describe('parseLmStudioModels', () => {
  it('reads the { models: [...] } shape LM Studio returns today', () => {
    const models = parseLmStudioModels(WRAPPED_IN_MODELS)
    expect(models).toHaveLength(2)
    expect(models[0]).toEqual({ id: 'lfm2.5-2.6b', contextWindow: 128000, supportsVision: false })
    expect(models[1]).toEqual({ id: 'zai-org/glm-4.6v-flash', contextWindow: 131072, supportsVision: true })
  })

  it('reads a bare array and a { data: [...] } wrapper the same way', () => {
    const expected = [{ id: 'a', contextWindow: 4096, supportsVision: false }]
    const entry = { key: 'a', max_context_length: 4096 }
    expect(parseLmStudioModels([entry])).toEqual(expected)
    expect(parseLmStudioModels({ data: [entry] })).toEqual(expected)
  })

  it('prefers the loaded context over the declared maximum', () => {
    // Declared is not loaded: LM Studio fits the KV cache to available VRAM and loads less than the
    // model advertises, silently. The loaded number is the one a caller can act on.
    const models = parseLmStudioModels({
      models: [
        {
          key: 'squeezed',
          max_context_length: 262144,
          loaded_instances: [{ config: { context_length: 126720 } }],
        },
      ],
    })
    expect(models[0]?.contextWindow).toBe(126720)
  })

  it('leaves the context window unset when the endpoint did not say', () => {
    // Distinct from reporting a default: a caller can tell "LM Studio has no opinion" from
    // "LM Studio said 200000", and only the first should fall through to another source.
    const models = parseLmStudioModels({ models: [{ key: 'quiet' }] })
    expect(models[0]).toEqual({ id: 'quiet', supportsVision: false })
    expect(models[0]?.contextWindow).toBeUndefined()
  })

  it('returns nothing rather than throwing for a shape it does not know', () => {
    // A caller that gets an empty list can fall through to /v1/models. A caller that gets an
    // exception cannot tell an unexpected answer from a server that is not running — which is
    // exactly how this bug stayed invisible.
    expect(parseLmStudioModels({ unexpected: true })).toEqual([])
    expect(parseLmStudioModels(null)).toEqual([])
    expect(parseLmStudioModels('nonsense')).toEqual([])
  })

  it('skips an entry with no id at all', () => {
    expect(parseLmStudioModels({ models: [{ max_context_length: 8192 }] })).toEqual([])
  })
})

describe('findLmStudioModel', () => {
  it('finds by the key LM Studio uses as the model id', () => {
    expect(findLmStudioModel(WRAPPED_IN_MODELS, 'lfm2.5-2.6b')?.contextWindow).toBe(128000)
  })

  it('is undefined for a model the server does not serve', () => {
    expect(findLmStudioModel(WRAPPED_IN_MODELS, 'not-loaded-here')).toBeUndefined()
  })
})
