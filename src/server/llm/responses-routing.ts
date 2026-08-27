/**
 * Model → API protocol routing.
 *
 * Some provider models are not served through the OpenAI chat completions
 * API. OpenCode Go (https://opencode.ai/docs/go/) serves a subset of its
 * catalog through OpenAI's Responses API (`/v1/responses`) and another subset
 * through the Anthropic Messages API (`/v1/messages`). Sending those models
 * to `/v1/chat/completions` is rejected by the gateway.
 *
 * This table is the single source of truth for which protocol a model id
 * speaks. It is matched case-insensitively on the full id OR its last path
 * segment (so org-prefixed ids like "openai/gpt-5.6-luna" resolve), with
 * word boundaries so "grok-4.6-turbo" never matches "grok-4.6".
 *
 * Extensible: future protocols (e.g. 'anthropic-messages') only need a new
 * entry here plus a client; unknown ids keep the default chat/completions
 * behavior.
 */

export type ApiProtocol = 'chat-completions' | 'responses'

interface ProtocolRule {
  pattern: RegExp
  protocol: ApiProtocol
}

const PROTOCOL_RULES: ProtocolRule[] = [
  {
    // OpenCode Go models served through OpenAI's Responses API.
    // Grok 4.6 is ZDR, which disables the stateful Responses API — the
    // gateway still exposes it at /v1/responses in stateless mode.
    pattern: /^(gpt-5\.6-luna|grok-4\.6|muse-spark-1\.2-contributor)$/i,
    protocol: 'responses',
  },
]

function basename(modelId: string): string {
  return modelId.split('/').pop() ?? modelId
}

export function resolveApiProtocol(modelId: string): ApiProtocol {
  const name = basename(modelId)
  for (const rule of PROTOCOL_RULES) {
    if (rule.pattern.test(modelId) || rule.pattern.test(name)) return rule.protocol
  }
  return 'chat-completions'
}

export function isResponsesApiModel(modelId: string): boolean {
  return resolveApiProtocol(modelId) === 'responses'
}
