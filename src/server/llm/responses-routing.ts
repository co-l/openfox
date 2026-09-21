/**
 * Model → API protocol routing.
 *
 * Which API a model request goes to is decided per model, but *scoped to the
 * backends that actually speak that protocol*:
 *
 * - OpenAI's gpt-5 family is served through the Responses API (`/v1/responses`)
 *   where tools + reasoning effort work together; on `/v1/chat/completions`
 *   those models reject tools with any effort other than "none". For the
 *   `openai` backend, the gpt-5 family's profile marks it `responses`.
 * - OpenCode Go (https://opencode.ai/docs/go/) serves a subset of its catalog
 *   (gpt-5.6-luna, grok-4.6, muse-spark-1.2-contributor) only through the
 *   Responses API — the curated table below covers those, on the `opencode-go`
 *   backend and, as a fallback, on `unknown` (providers created before the
 *   backend was picked or added as "Other" still work; local inference engines
 *   never serve these curated ids, so the fallback cannot mis-route them).
 *
 * The `/v1/responses` endpoint is OpenAI-specific: vLLM, Ollama, llama.cpp and
 * friends only speak chat completions, so a global model-name match would
 * wrongly route those. Routing is therefore backend-aware — an explicit
 * per-model override (persisted on the model config) wins over everything.
 *
 * Extensible: future protocols (e.g. 'anthropic-messages') only need a new
 * entry here plus a client; unknown ids keep the default chat/completions
 * behavior.
 */

import type { Backend } from './backend.js'

export type ApiProtocol = 'chat-completions' | 'responses'

export interface ProtocolResolutionInput {
  /** The model id (may be org-prefixed, e.g. "openai/gpt-5.6-luna"). */
  model: string
  /** The provider backend. */
  backend: Backend
  /** The model profile's preferred protocol (e.g. gpt-5 family → responses). */
  profileApiProtocol?: ApiProtocol | undefined
  /** Explicit per-model override persisted on the model config. */
  explicitApiProtocol?: ApiProtocol | undefined
}

interface ProtocolRule {
  pattern: RegExp
  protocol: ApiProtocol
}

// OpenCode Go models served through OpenAI's Responses API. Grok 4.6 is ZDR,
// which disables the stateful Responses API — the gateway still exposes it at
// /v1/responses in stateless mode. Matched case-insensitively on the full id
// OR its last path segment, anchored so "grok-4.6-turbo" never matches.
const OPENCODE_GO_RESPONSES_RULES: ProtocolRule[] = [
  {
    pattern: /^(gpt-5\.6-luna|grok-4\.6|muse-spark-1\.2-contributor)$/i,
    protocol: 'responses',
  },
]

function basename(modelId: string): string {
  return modelId.split('/').pop() ?? modelId
}

function matchesRules(modelId: string, rules: ProtocolRule[]): ApiProtocol | undefined {
  const name = basename(modelId)
  for (const rule of rules) {
    if (rule.pattern.test(modelId) || rule.pattern.test(name)) return rule.protocol
  }
  return undefined
}

/**
 * Resolve the API protocol for a model on a given backend.
 * Explicit override > openai backend + profile protocol > OpenCode Go curated
 * table (also applied on the 'unknown' backend, so providers created before the
 * curated table existed keep working — local inference engines never serve
 * these ids) > chat completions.
 */
export function resolveApiProtocol(input: ProtocolResolutionInput): ApiProtocol {
  const { model, backend, profileApiProtocol, explicitApiProtocol } = input
  if (explicitApiProtocol) return explicitApiProtocol
  if (backend === 'openai' && profileApiProtocol) return profileApiProtocol
  if (backend === 'opencode-go' || backend === 'unknown') {
    const matched = matchesRules(model, OPENCODE_GO_RESPONSES_RULES)
    if (matched) return matched
  }
  return 'chat-completions'
}

export function isResponsesApiModel(input: ProtocolResolutionInput): boolean {
  return resolveApiProtocol(input) === 'responses'
}
