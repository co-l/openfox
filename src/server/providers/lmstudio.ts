/**
 * LM Studio's native model endpoint, parsed in one place.
 *
 * `/api/v1/models` has been observed returning three shapes across LM Studio versions: a bare
 * array, `{ data: [...] }`, and `{ models: [...] }` — the last is what 0.3.x returns today. Two
 * callers need that list (the provider model fetch and auto-config's context detection), and when
 * each parsed it for itself they disagreed: one tolerated all three shapes, the other assumed a bare
 * array and threw `data.find is not a function` on every real response.
 *
 * The failure was silent by construction. Auto-config catches detection errors and falls back to a
 * `'default'` context window, and the UI deliberately ignores a `'default'` result — so pressing
 * Auto-config against LM Studio quietly set thinking parameters and never set a context window at
 * all, leaving the user to type one by hand.
 *
 * So the parsing lives here and both callers ask it, rather than each carrying its own copy of a
 * rule they have already been caught disagreeing about.
 */

/** One model as LM Studio describes it, reduced to what a caller here needs. */
export interface LmStudioModel {
  id: string
  /**
   * The context this model can serve, if the endpoint said.
   *
   * **The loaded instance wins over the declared maximum**, because LM Studio fits the KV cache to
   * available VRAM and loads a smaller window than the model advertises, without saying so. The
   * number that matters to a caller is the one currently loaded.
   */
  contextWindow?: number
  supportsVision: boolean
}

interface RawLmStudioModel {
  key?: string
  id?: string
  max_context_length?: number
  loaded_instances?: Array<{ id?: string; config?: { context_length?: number } }>
  capabilities?: { vision?: boolean }
}

/** Pull the model array out of whichever shape this LM Studio returned. */
function unwrap(raw: unknown): RawLmStudioModel[] {
  if (Array.isArray(raw)) return raw as RawLmStudioModel[]
  if (raw && typeof raw === 'object') {
    const record = raw as { models?: unknown; data?: unknown }
    if (Array.isArray(record.models)) return record.models as RawLmStudioModel[]
    if (Array.isArray(record.data)) return record.data as RawLmStudioModel[]
  }
  return []
}

/**
 * Every model the response describes, in the order it listed them.
 *
 * Returns an empty array for a shape this does not recognise rather than throwing: a caller that
 * gets nothing back can fall through to `/v1/models`, where a caller that gets an exception cannot
 * tell "LM Studio answered something unexpected" from "LM Studio is not running".
 */
export function parseLmStudioModels(raw: unknown): LmStudioModel[] {
  return unwrap(raw)
    .map((model) => {
      const id = model.key ?? model.id ?? ''
      const loaded = model.loaded_instances?.[0]?.config?.context_length
      const contextWindow = loaded ?? model.max_context_length
      return {
        id,
        ...(contextWindow ? { contextWindow } : {}),
        supportsVision: model.capabilities?.vision ?? false,
      }
    })
    .filter((model) => model.id !== '')
}

/** One model by the id a caller holds, or `undefined`. */
export function findLmStudioModel(raw: unknown, modelId: string): LmStudioModel | undefined {
  return parseLmStudioModels(raw).find((model) => model.id === modelId)
}
