/**
 * Shared vision-capability heuristics used across model detection paths.
 *
 * Both auto-config and provider-manager probe a model's `model_info` to decide
 * whether it supports vision. The keys that signal vision vary by backend; a
 * single helper guarantees the two call sites agree instead of drifting (e.g.
 * `clip.vision_projection` should classify the same way regardless of path).
 */

/**
 * True when a model_info object carries positive vision evidence.
 * Recognized signals: a non-null `vision_start_token_id`, or any key containing
 * a `.vision` / `vision_` segment (e.g. `clip.vision_projection`, `clip.vision`).
 * Emits boolean only on positive evidence; absence is not treated as an
 * explicit "no" so a model-profile default can still rescue it downstream.
 */
export function hasVisionEvidence(modelInfo: Record<string, unknown>): boolean {
  return (
    !!modelInfo['vision_start_token_id'] ||
    Object.keys(modelInfo).some((k) => k.includes('.vision') || k.includes('vision_'))
  )
}
