/**
 * Transition Handler Registry
 *
 * Extension point for custom workflow transition conditions. Plugins register
 * async handlers keyed by an id; a workflow step declares a transition with
 * `when: { type: 'custom', handler: '<id>', config?: {...} }` and the executor
 * invokes the matching handler to decide whether the transition fires.
 *
 * Built-in condition types (step_result, metadata_all_match, metadata_all_in,
 * always) remain evaluated synchronously by the executor. Only `custom`
 * conditions go through this registry, keeping the common path unchanged.
 */

import type { MetadataEntry } from '../../shared/types.js'
import type { LLMClientWithModel } from '../llm/client.js'

/** Structural twin of executor's StepOutcome — avoids a circular import. */
export interface StepOutcomeLike {
  result: string
  output: Record<string, string>
}

export interface TransitionHandlerContext {
  /** Result + output of the step whose transitions are being evaluated. */
  stepOutcome: StepOutcomeLike | null
  /** Session metadata entries (criteria, review_findings, …). */
  metadataEntries?: Record<string, MetadataEntry[]> | undefined
  /** Workflow being executed. */
  workflowId: string
  /** Step whose transitions are being evaluated. */
  stepId: string
  /** Free-form config declared on the `custom` condition. */
  config?: Record<string, unknown> | undefined
  /** Abort signal forwarded from the orchestrator. */
  signal?: AbortSignal | undefined
  /**
   * LLM client a custom handler may call to make a routing decision (e.g. the
   * built-in `llm_decision` handler). For step transitions this is the
   * step's resolved client (honoring per-step/team overrides); for the start
   * condition it is the session client. Undefined when no client is available.
   */
  llmClient?: LLMClientWithModel | undefined
}

/** A transition handler returns true to fire the transition, false to skip it. */
export type TransitionHandler = (ctx: TransitionHandlerContext) => Promise<boolean>

export class TransitionHandlerRegistry {
  private readonly handlers = new Map<string, TransitionHandler>()

  register(handlerId: string, handler: TransitionHandler): void {
    if (!handlerId.trim()) throw new Error('Transition handler id cannot be empty')
    this.handlers.set(handlerId, handler)
  }

  get(handlerId: string): TransitionHandler | undefined {
    return this.handlers.get(handlerId)
  }

  has(handlerId: string): boolean {
    return this.handlers.has(handlerId)
  }

  list(): string[] {
    return [...this.handlers.keys()]
  }
}
