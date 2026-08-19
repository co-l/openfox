/**
 * Built-in `llm_decision` transition handler — dynamic orchestration.
 *
 * A workflow step whose transitions carry `when: { type: 'custom', handler:
 * 'llm_decision', config }` asks the orchestrator LLM to pick the next step.
 * Each sibling transition declares the shared `candidates` list plus its own
 * `thisGoto`; the handler makes ONE LLM call per (workflow, step, outcome) and
 * fires only the transition whose `thisGoto` matches the LLM's choice.
 *
 * Config shape (per transition):
 *   {
 *     prompt?: string,                              // optional custom question
 *     candidates: Array<{ goto: string, label: string, description?: string }>,
 *     thisGoto: string,                             // the goto this transition routes to
 *     temperature?: number                          // optional sampling override
 *   }
 *
 * The orchestrator LLM is `ctx.llmClient`: for step transitions this is the
 * step's resolved model (honoring per-step/team overrides), so "which LLM
 * orchestrates" is configurable per step. When no client is available or the
 * call fails, the handler returns false so a following `always` fallback can
 * win — the workflow never blocks on a routing decision.
 */

import type { LLMMessage, LLMCompletionRequest } from '../llm/types.js'
import type { TransitionHandler, TransitionHandlerContext } from './transition-handlers.js'

interface DecisionCandidate {
  goto: string
  label: string
  description?: string
}

interface LlmDecisionConfig {
  prompt?: string
  candidates: DecisionCandidate[]
  thisGoto: string
  temperature?: number
}

/** Sentinel cached when the LLM produces no parseable choice. */
const NO_CHOICE = '__no_choice__'

/**
 * Decision cache keyed by (workflow, step, outcome, candidate set). Lets all
 * sibling transitions of one step share a single LLM call. Module-level by
 * design: a routing decision for a given outcome must be stable within a run.
 */
const decisionCache = new Map<string, string>()

/** Test-only reset hook. */
export function __resetLlmDecisionCache(): void {
  decisionCache.clear()
}

function outcomeToken(stepOutcome: TransitionHandlerContext['stepOutcome']): string {
  if (!stepOutcome) return 'null'
  const output = stepOutcome.output ?? {}
  const keys = Object.keys(output).sort()
  const out = keys.map((k) => `${k}=${output[k] ?? ''}`).join('|')
  return `${stepOutcome.result ?? ''}|${out}`
}

function candidatesToken(candidates: DecisionCandidate[]): string {
  return candidates
    .map((c) => `${c.label}::${c.goto}`)
    .sort()
    .join('||')
}

function cacheKey(ctx: TransitionHandlerContext, candidates: DecisionCandidate[]): string {
  return `${ctx.workflowId}:${ctx.stepId}:${outcomeToken(ctx.stepOutcome)}:${candidatesToken(candidates)}`
}

function readConfig(raw: Record<string, unknown> | undefined): LlmDecisionConfig | null {
  if (!raw) return null
  const thisGoto = typeof raw['thisGoto'] === 'string' ? (raw['thisGoto'] as string) : undefined
  if (!thisGoto) return null
  const candidatesRaw = raw['candidates']
  if (!Array.isArray(candidatesRaw)) return null
  const candidates: DecisionCandidate[] = []
  for (const c of candidatesRaw) {
    if (typeof c !== 'object' || c === null) continue
    const obj = c as Record<string, unknown>
    const goto = typeof obj['goto'] === 'string' ? (obj['goto'] as string) : undefined
    const label = typeof obj['label'] === 'string' ? (obj['label'] as string) : undefined
    if (!goto || !label) continue
    const candidate: DecisionCandidate = { goto, label }
    if (typeof obj['description'] === 'string') candidate.description = obj['description'] as string
    candidates.push(candidate)
  }
  if (candidates.length === 0) return null
  const cfg: LlmDecisionConfig = { candidates, thisGoto }
  if (typeof raw['prompt'] === 'string') cfg.prompt = raw['prompt'] as string
  if (typeof raw['temperature'] === 'number') cfg.temperature = raw['temperature'] as number
  return cfg
}

function buildMessages(cfg: LlmDecisionConfig, ctx: TransitionHandlerContext): LLMMessage[] {
  const lines = cfg.candidates.map((c) => `- ${c.label}${c.description ? `: ${c.description}` : ''} (goto: ${c.goto})`)
  const question = cfg.prompt ?? 'Choose the best next step for this workflow.'
  const outcome = ctx.stepOutcome
    ? `result="${ctx.stepOutcome.result}" output=${JSON.stringify(ctx.stepOutcome.output ?? {})}`
    : 'no step outcome yet (start of workflow)'
  const user = [
    question,
    '',
    'Available next steps:',
    ...lines,
    '',
    `Current step: ${ctx.stepId} (workflow: ${ctx.workflowId})`,
    `Step outcome: ${outcome}`,
    '',
    'Reply with ONLY the label of the chosen step, nothing else.',
  ].join('\n')

  return [
    {
      role: 'system',
      content:
        'You are a workflow orchestrator. You decide which step runs next. ' +
        'Reply with ONLY the label of exactly one candidate step, nothing else.',
    },
    { role: 'user', content: user },
  ]
}

function parseChoice(content: string, candidates: DecisionCandidate[]): string | null {
  const text = content.trim().toLowerCase()
  if (!text) return null
  // Exact label match first.
  for (const c of candidates) {
    if (text === c.label.toLowerCase()) return c.goto
  }
  // Exact goto match (some models echo the id).
  for (const c of candidates) {
    if (text === c.goto.toLowerCase()) return c.goto
  }
  // Substring fallback: first candidate label appearing in the response.
  for (const c of candidates) {
    if (text.includes(c.label.toLowerCase())) return c.goto
  }
  return null
}

/**
 * Resolve the LLM's choice for the given context, using the cache when the
 * same (workflow, step, outcome, candidates) has been seen. Returns the chosen
 * goto, NO_CHOICE when the response was unparseable, or null when no decision
 * could be made (no client, call failure, bad config).
 */
async function resolveChoice(
  cfg: LlmDecisionConfig,
  ctx: TransitionHandlerContext,
  key: string,
): Promise<string | null> {
  const cached = decisionCache.get(key)
  if (cached !== undefined) return cached

  if (!ctx.llmClient) {
    return null
  }

  const request: LLMCompletionRequest = {
    messages: buildMessages(cfg, ctx),
    temperature: cfg.temperature ?? 0,
    skipClientReasoningEffort: true,
  }
  if (ctx.signal) request.signal = ctx.signal

  let choice: string | null = null
  try {
    const response = await ctx.llmClient.complete(request)
    choice = parseChoice(response.content, cfg.candidates)
  } catch {
    // A failed call leaves choice at null → cached as NO_CHOICE below.
  }

  // Always cache so sibling transitions share the single call: a parse failure
  // (or a thrown call) is cached as NO_CHOICE so a dead upstream isn't queried
  // once per transition.
  decisionCache.set(key, choice ?? NO_CHOICE)
  return choice
}

/** Factory: a fresh handler closure (shares the module-level cache). */
export function createLlmDecisionHandler(): TransitionHandler {
  return async (ctx: TransitionHandlerContext): Promise<boolean> => {
    const cfg = readConfig(ctx.config)
    if (!cfg) return false

    const key = cacheKey(ctx, cfg.candidates)
    const choice = await resolveChoice(cfg, ctx, key)
    if (choice === null) return false
    return choice === cfg.thisGoto
  }
}
