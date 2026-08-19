/**
 * Shared HTTP body parsing for model-override routes.
 *
 * Both the agent-override (`/api/agents/:id/model`) and step-override
 * (`/api/workflows/:workflowId/steps/:stepId/model`) PUT handlers validate the
 * same { providerId, model, reasoningEffort? } body. Centralizing the destructure
 * + reasoningEffort guard keeps jscpd at 0% and the two routes in sync.
 */

import { isReasoningEffortValue } from '../providers/model-catalog.js'

export interface OverrideFields {
  providerId: string | undefined
  model: string | undefined
  reasoningEffort: string | undefined
  error: string | null
}

export function readOverrideFields(body: unknown): OverrideFields {
  const { providerId, model, reasoningEffort } = (body ?? {}) as {
    providerId?: string
    model?: string
    reasoningEffort?: string
  }
  if (reasoningEffort !== undefined && !isReasoningEffortValue(reasoningEffort)) {
    return { providerId, model, reasoningEffort, error: `Unsupported reasoningEffort: ${reasoningEffort}` }
  }
  return { providerId, model, reasoningEffort, error: null }
}
