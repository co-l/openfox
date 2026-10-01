/**
 * Canonical reasoning_effort vocabulary understood across providers.
 *
 * Single source of truth shared by the server (validation, model catalog,
 * auto-config) and the web client (pickers, `provider/model:effort` parsing).
 * Keep this list in sync with what providers actually advertise — see
 * `src/server/providers/model-catalog.ts` for per-family values.
 */

export const REASONING_EFFORT_VALUES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type ReasoningEffortValue = (typeof REASONING_EFFORT_VALUES)[number]

export function isReasoningEffortValue(value: string): boolean {
  return (REASONING_EFFORT_VALUES as readonly string[]).includes(value)
}

export function isReasoningEffortValidForModel(
  effort: string | undefined | null,
  model?: { modes?: Array<{ level: string }>; reasoningEfforts?: string[] },
): boolean {
  if (!effort) return false
  if (isReasoningEffortValue(effort)) return true
  if (model?.modes?.some((m) => m.level === effort)) return true
  if (model?.reasoningEfforts?.includes(effort)) return true
  return false
}

export interface ResolveEffortForModelOptions {
  /** The model's advertised preset list (UI chips). Absent/empty = no constraint. */
  reasoningEfforts?: string[]
  /** An explicit effort (session pick, pin, or agent override). */
  candidate?: string
  /** The model's configured default (thinkingLevel-based), clamped to the list. */
  defaultEffort?: string
  /** The model's raw reasoning-effort override — sent verbatim, never clamped. */
  override?: string
}

/**
 * Resolve the reasoning effort to actually send for a model, honoring the
 * model's advertised preset list.
 *
 * - An explicit `none` is always honored verbatim — the universal "thinking
 *   off" switch must never be silently turned into a level.
 * - An explicit candidate beats the model defaults: in-list candidates pass
 *   through; out-of-list candidates fall back to the override (escape hatch),
 *   else the advertised default, else the first advertised value.
 * - Without an explicit effort the model default applies: the override verbatim
 *   (never clamped), else `defaultEffort` only when the model advertises it.
 * - Without a list nothing is constrained — candidate, override, and default
 *   pass through as-is.
 */
export function resolveEffortForModel({
  reasoningEfforts,
  candidate,
  defaultEffort,
  override,
}: ResolveEffortForModelOptions): string | undefined {
  if (candidate === 'none') return 'none'
  if (!reasoningEfforts || reasoningEfforts.length === 0) {
    return candidate ?? override ?? defaultEffort
  }
  if (candidate) {
    if (reasoningEfforts.includes(candidate)) return candidate
    if (override) return override
    if (defaultEffort && reasoningEfforts.includes(defaultEffort)) return defaultEffort
    return reasoningEfforts[0]
  }
  if (override) return override
  return defaultEffort && reasoningEfforts.includes(defaultEffort) ? defaultEffort : undefined
}

// ============================================================================
// Mode-suffix model merging (providers that expose one model as several ids
// differing only by a trailing mode suffix, e.g. "gemini-3.6-flash-low" /
// "gemini-3.6-flash-medium" / "gemini-3.6-flash-high").
// ============================================================================

/** Suffixes OmniRoute-style providers use to qualify a mode on model IDs/names. */
export const MODE_SUFFIXES = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type ModeSuffix = (typeof MODE_SUFFIXES)[number]

/**
 * Sentinel context window used when a model's real limit is unknown.
 * A stored value equal to this means "unset" and can be overwritten by catalog data.
 */
export const UNKNOWN_CONTEXT_WINDOW = 200000

/** Sort a list of models by semantic mode level (low → medium → high → xhigh → max). */
export function sortByModeLevel<T extends { id: string }>(models: T[]): T[] {
  const levelOrder = new Map<string, number>(MODE_SUFFIXES.map((s, i) => [s, i]))
  return [...models].sort((a, b) => {
    const la = splitModeSuffix(a.id)?.level
    const lb = splitModeSuffix(b.id)?.level
    const ia = la !== undefined ? (levelOrder.get(la) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
    const ib = lb !== undefined ? (levelOrder.get(lb) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
    return ia - ib || a.id.localeCompare(b.id)
  })
}

export interface ModeModelSeed {
  id: string
  name?: string
}

/**
 * Detect whether a model ID carries a trailing mode suffix (e.g. `base-suffix`),
 * returning the stripped base ID and the suffix, or undefined when the ID has no
 * trailing hyphen-separated segment.
 */
export function splitModeSuffix(id: string): { base: string; level: string } | undefined {
  const lastSlashIndex = id.lastIndexOf('/')
  const searchStart = lastSlashIndex >= 0 ? lastSlashIndex + 1 : 0
  const lastHyphenIndex = id.lastIndexOf('-')
  if (lastHyphenIndex <= searchStart || lastHyphenIndex === id.length - 1) {
    return undefined
  }
  const level = id.slice(lastHyphenIndex + 1)
  if (!MODE_SUFFIXES.includes(level as ModeSuffix)) {
    return undefined
  }
  return {
    base: id.slice(0, lastHyphenIndex),
    level,
  }
}

/**
 * Group a list of models into "families" that differ only by a trailing mode
 * suffix. Returns the grouped families, each with a stable base name (the
 * un-suffixed model's name/ID, else the stripped member's name) and the
 * members. Families with fewer than 2 members are not returned.
 */
export function groupModeFamilies(
  models: ModeModelSeed[],
): Array<{ baseId: string; name: string; members: ModeModelSeed[] }> {
  const byId = new Map(models.map((m) => [m.id, m]))
  const families = new Map<string, { name: string; members: ModeModelSeed[] }>()
  for (const model of models) {
    const split = splitModeSuffix(model.id)
    if (!split) continue
    const existing = families.get(split.base)
    if (existing) {
      existing.members.push(model)
    } else {
      families.set(split.base, { name: model.name ?? split.base, members: [model] })
    }
  }
  const result: Array<{ baseId: string; name: string; members: ModeModelSeed[] }> = []
  for (const [baseId, family] of families) {
    if (family.members.length < 2) continue
    const baseModel = byId.get(baseId)
    const name = baseModel?.name ?? family.name ?? baseId
    result.push({ baseId, name, members: family.members })
  }
  return result
}

export interface ModeModelEntry {
  id: string
  name?: string
  apiModelId?: string
  contextWindow?: number
  supportsVision?: boolean
  modes?: Array<{ level: string; apiModelId: string; name?: string }>
  reasoningEfforts?: string[]
  source?: 'backend' | 'user' | 'default'
}

/**
 * Automatically collapse a list of models containing suffixed mode variants
 * (-low, -medium, -high) into merged models with `modes` and `reasoningEfforts`.
 */
export function collapseModeFamilies<T extends ModeModelEntry>(models: T[]): T[] {
  const unmerged = models.filter((m) => !m.modes?.length)
  const families = groupModeFamilies(unmerged)
  if (families.length === 0) return models

  let result = [...models]
  for (const family of families) {
    const baseModel = result.find((m) => m.id === family.baseId)
    const members = result.filter((m) => family.members.some((mem) => mem.id === m.id))
    if (members.length < 2) continue

    const sorted = sortByModeLevel(members)

    // The merged model is named after the un-suffixed base model when the
    // catalog exposes one; otherwise the base id is all we can derive a display
    // name from (member names carry the mode suffix and must not leak into the
    // merged entry). Providers that care about the display name advertise the
    // clean base name themselves.
    const baseName = baseModel?.name ?? family.baseId.split('/').pop()?.replace(/-/g, ' ') ?? family.baseId

    const merged = {
      ...sorted[0],
      ...(baseModel ?? {}),
      id: family.baseId,
      name: baseName,
      apiModelId: baseModel?.apiModelId ?? (baseModel ? family.baseId : undefined),
      contextWindow: baseModel?.contextWindow ?? sorted[0]?.contextWindow ?? UNKNOWN_CONTEXT_WINDOW,
      supportsVision: baseModel?.supportsVision ?? sorted.some((m) => m.supportsVision),
      reasoningEfforts: sorted.map((m) => splitModeSuffix(m.id)?.level).filter((l): l is string => Boolean(l)),
      modes: sorted.map((m) => ({
        level: splitModeSuffix(m.id)!.level,
        apiModelId: m.apiModelId ?? m.id,
        ...(m.name !== undefined ? { name: m.name.split('/').pop() ?? m.name } : {}),
      })),
      source: baseModel?.source ?? sorted[0]?.source ?? ('backend' as const),
    } as T

    const removedIds = new Set(members.map((m) => m.id))
    result = [merged, ...result.filter((m) => !removedIds.has(m.id) && m.id !== family.baseId)]
  }

  return result
}

/**
 * Resolve the concrete provider model ID to send for a model given a resolved
 * reasoning effort, and whether the effort should be forwarded as a
 * `reasoning_effort` param.
 *
 * When the model is a merged mode model (has `modes`), the effort selects the
 * matching per-level `apiModelId`; the effort is then encoded in the distinct
 * provider id and must NOT also be sent as a `reasoning_effort` param. When the
 * effort matches no listed mode, the model's base `apiModelId` (or the model id)
 * is sent and the effort is forwarded as usual.
 */
export function resolveModeModelId(
  modes: Array<{ level: string; apiModelId: string; name?: string }> | undefined,
  effort: string | undefined,
  fallbackApiModelId: string | undefined,
  modelId: string,
): { modelId: string; suppressEffort: boolean } {
  const modeEntry = modes?.find((mode) => mode.level === effort)
  if (modeEntry) {
    return { modelId: modeEntry.apiModelId, suppressEffort: true }
  }
  return { modelId: fallbackApiModelId ?? modelId, suppressEffort: false }
}
