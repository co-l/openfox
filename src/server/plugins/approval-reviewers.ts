import type { PluginApprovalContext, PluginApprovalDecision, PluginApprovalReviewer } from '../../plugin/index.js'
import { logger } from '../utils/logger.js'

export interface OwnedPluginApprovalReviewer {
  pluginId: string
  reviewer: PluginApprovalReviewer
}

const DEFAULT_TIMEOUT_MS = 15_000

let reviewers: OwnedPluginApprovalReviewer[] = []

export function setPluginApprovalReviewers(next: OwnedPluginApprovalReviewer[]): void {
  reviewers = [...next]
}

export function listPluginApprovalReviewers(): OwnedPluginApprovalReviewer[] {
  return [...reviewers]
}

export function clearPluginApprovalReviewers(): void {
  reviewers = []
}

function normalizeDecision(decision: PluginApprovalDecision): PluginApprovalDecision | undefined {
  if (!decision || typeof decision !== 'object') return undefined
  if (decision.action === 'allow' || decision.action === 'ask') return { action: decision.action }
  if (decision.action === 'deny') {
    return {
      action: 'deny',
      reason: typeof decision.reason === 'string' && decision.reason ? decision.reason : 'Denied by approval reviewer.',
    }
  }
  return undefined
}

/**
 * Consult registered approval reviewers for a confirmation request.
 *
 * Fail-closed contract: returns `undefined` when no reviewer is registered,
 * when a reviewer throws, times out, or returns an unrecognized decision —
 * callers then fall through to the native confirmation flow. A broken or
 * absent reviewer can therefore never bypass or weaken OpenFox's behavior.
 */
async function evaluateOne(
  owned: OwnedPluginApprovalReviewer,
  context: PluginApprovalContext,
  timeoutMs: number,
): Promise<PluginApprovalDecision | undefined> {
  try {
    // Attach a no-op catch first: if the reviewer rejects after the timeout
    // race has already settled, it must not surface as an unhandled rejection.
    const evaluation = Promise.resolve().then(() => owned.reviewer.evaluate(context))
    evaluation.catch(() => {})
    const result = await Promise.race([
      evaluation,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('approval reviewer timed out')), timeoutMs)
        if (typeof timer.unref === 'function') timer.unref()
      }),
    ])
    const normalized = normalizeDecision(result)
    if (!normalized) {
      logger.warn('Plugin approval reviewer returned an unrecognized decision', { pluginId: owned.pluginId })
      return undefined
    }
    return normalized
  } catch (error) {
    logger.warn('Plugin approval reviewer failed', {
      pluginId: owned.pluginId,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

const RANK: Record<PluginApprovalDecision['action'], number> = { allow: 0, ask: 1, deny: 2 }

/**
 * Consult registered approval reviewers for a confirmation request.
 *
 * Multiple reviewers are combined with strictest-wins semantics
 * (deny > ask > allow).
 *
 * Fail-closed contract: returns `undefined` when no reviewer is registered,
 * when every reviewer throws/times out, or when decisions are unrecognized —
 * callers then fall through to the native confirmation flow. A broken or
 * absent reviewer can therefore never bypass or weaken OpenFox's behavior.
 */
export async function evaluatePluginApproval(
  context: PluginApprovalContext,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<PluginApprovalDecision | undefined> {
  if (reviewers.length === 0) return undefined
  const results = await Promise.all(reviewers.map((owned) => evaluateOne(owned, context, timeoutMs)))
  const decisions = results.filter((decision): decision is PluginApprovalDecision => decision !== undefined)
  if (decisions.length === 0) return undefined
  return decisions.reduce((strictest, candidate) =>
    RANK[candidate.action] > RANK[strictest.action] ? candidate : strictest,
  )
}
