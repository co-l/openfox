/**
 * Auto-action timeout resolution.
 *
 * One user-facing value (seconds) drives both automatic behaviors: the
 * favorite-workflow auto-launch countdown and the ask_user auto-answer
 * countdown. Project override first, then the global setting; non-numeric or
 * out-of-range values fall back to the default.
 */

import { getProjectAutoActionTimeout } from '../db/projects.js'
import { getSetting, SETTINGS_KEYS } from '../db/settings.js'

export const DEFAULT_AUTO_ACTION_TIMEOUT_SECONDS = 90

function parseSeconds(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isInteger(value) && value >= 1 ? value : null
}

/** Resolved timeout in seconds for a session scope (project override > global > default). */
export function resolveAutoActionTimeoutSeconds(projectId?: string): number {
  if (projectId) {
    try {
      const projectValue = getProjectAutoActionTimeout(projectId)
      if (projectValue !== null) return projectValue
    } catch {
      // fall through to the global setting
    }
  }
  try {
    const parsed = parseSeconds(getSetting(SETTINGS_KEYS.AUTO_ACTION_TIMEOUT))
    if (parsed !== null) return parsed
  } catch {
    // fall through to the default
  }
  return DEFAULT_AUTO_ACTION_TIMEOUT_SECONDS
}
