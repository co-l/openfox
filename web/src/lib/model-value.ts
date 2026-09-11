/**
 * Canonical "providerId/model:reasoningEffort" value handling.
 *
 * A provider/model selection is represented as a single string so it can flow
 * through pickers and agent overrides unchanged. The effort is an optional
 * `:effort` suffix on the model id. Model ids may themselves contain ':' (e.g.
 * ollama tags like "deepseek-r1:70b"), so parsing only treats the suffix as an
 * effort when it matches a known reasoning-effort value.
 *
 * The effort vocabulary is shared with the server (`src/shared/reasoning-effort.ts`)
 * so the UI accepts exactly the values the server validates.
 */

import {
  REASONING_EFFORT_VALUES,
  isReasoningEffortValue,
  formatModelValue,
  parseModelValue,
  type ReasoningEffortValue,
  type ModelValue,
} from '@shared/model-value.js'

export { REASONING_EFFORT_VALUES, isReasoningEffortValue, formatModelValue, parseModelValue }
export type { ReasoningEffortValue, ModelValue }
