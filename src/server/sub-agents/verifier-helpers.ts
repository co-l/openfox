/**
 * Verifier Helpers
 *
 * Nudge/stall logic for the verifier sub-agent.
 */

import type { Criterion } from '../../shared/types.js'
import type { NudgeConfig } from './manager.js'

export const MAX_CONSECUTIVE_VERIFIER_NUDGES = 10
export const VERIFIER_STALL_REASON = 'Verifier stopped repeatedly before terminalizing verification after repeated nudges.'

export function getCriteriaAwaitingVerification(criteria: Criterion[]): Criterion[] {
  return criteria.filter((criterion) => criterion.status.type === 'completed')
}

export function buildVerifierNudgeContent(criteria: Criterion[]): string {
  const ids = criteria.map((criterion) => criterion.id).join(', ')
  return `You stopped before finalizing verification. ${criteria.length} criteria still need a terminal verification result. Use pass_criterion or fail_criterion for each remaining criterion: ${ids}.`
}

export function buildVerifierRestartContent(criteria: Criterion[]): string {
  const ids = criteria.map((criterion) => criterion.id).join(', ')
  return `${VERIFIER_STALL_REASON} Leaving remaining criteria unchanged so verification can restart in a fresh window: ${ids}.`
}

export function createVerifierNudgeConfig(): NudgeConfig {
  return {
    maxConsecutiveNudges: MAX_CONSECUTIVE_VERIFIER_NUDGES,
    getCriteriaAwaiting: getCriteriaAwaitingVerification,
    buildNudgeContent: buildVerifierNudgeContent,
    buildRestartContent: buildVerifierRestartContent,
  }
}
