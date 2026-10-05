export interface RetryPatternConfig {
  field: 'thinking' | 'content' | 'both'
  pattern: string
  action: 'retry'
  active: boolean
}

export interface RetryPatternMatch {
  pattern: string
  field: string
  matchedContent: string
}

const VALID_FIELDS = ['thinking', 'content', 'both'] as const

export function matchRetryPatterns(
  content: string,
  thinking: string | undefined,
  patterns: RetryPatternConfig[],
): RetryPatternMatch[] {
  const matches: RetryPatternMatch[] = []

  for (const config of patterns) {
    if (!config.active) continue
    if (!config.pattern || config.pattern.trim() === '') continue

    let regex: RegExp
    try {
      regex = new RegExp(config.pattern)
    } catch {
      continue
    }

    const testContent = config.field === 'thinking' ? false : regex.test(content)
    const testThinking = config.field === 'content' ? false : thinking !== undefined && regex.test(thinking)

    if (testContent) {
      matches.push({ pattern: config.pattern, field: config.field, matchedContent: content })
    }
    if (testThinking) {
      matches.push({ pattern: config.pattern, field: config.field, matchedContent: thinking! })
    }
  }

  return matches
}

export function validateRetryPatterns(patterns: RetryPatternConfig[]): string[] {
  const errors: string[] = []

  for (const [i, p] of patterns.entries()) {
    if (!VALID_FIELDS.includes(p.field as (typeof VALID_FIELDS)[number])) {
      errors.push(`Pattern ${i}: Invalid field "${p.field}". Must be "thinking", "content", or "both".`)
    }
    if (!p.pattern || p.pattern.trim() === '') {
      errors.push(`Pattern ${i}: Pattern is required.`)
    } else {
      try {
        new RegExp(p.pattern)
      } catch {
        errors.push(`Pattern ${i}: Invalid regex "${p.pattern}".`)
      }
    }
  }

  return errors
}

export function sanitizeRetryPatterns(patterns: RetryPatternConfig[]): RetryPatternConfig[] {
  return patterns.filter(
    (p) => p.pattern && p.pattern.trim() !== '' && isValidPattern(p.pattern) && VALID_FIELDS.includes(p.field),
  )
}

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the user-configured auto-retry patterns (and the per-turn retry cap)
 * from the settings DB. Used as the loop's retryPatternsProvider so a mid-turn
 * edit in the settings UI takes effect on the next LLM round.
 *
 * When no setting is stored, falls back to the legacy llm.disableXmlProtection
 * setting (migrated to the default XML tool-call protection pattern).
 */
export async function buildRetryPatterns(): Promise<{
  retryPatterns: RetryPatternConfig[]
  maxRetriesPerTurn: number
}> {
  const { getSetting, setSetting, SETTINGS_KEYS } = await import('../db/settings.js')
  const raw = getSetting(SETTINGS_KEYS.RETRY_PATTERNS)
  if (!raw) {
    // Migration: check old llm.disableXmlProtection setting
    const oldXmlProtection = getSetting('llm.disableXmlProtection')
    if (oldXmlProtection !== null) {
      // User had the old setting — migrate to retry patterns
      const disabled = oldXmlProtection === 'true'
      const migrated = sanitizeRetryPatterns(
        disabled
          ? []
          : [
              {
                field: 'both',
                pattern: '<(tool_call|function=|/tool_call|parameter=)',
                action: 'retry',
                active: true,
              },
            ],
      )
      // Persist the migrated value once (best-effort) so the settings UI —
      // which reads the stored row, not this fallback — agrees with the
      // server, and a later editor save can't silently drop the pattern.
      try {
        setSetting(SETTINGS_KEYS.RETRY_PATTERNS, JSON.stringify({ patterns: migrated, maxRetriesPerTurn: 10 }))
      } catch {
        // Settings unavailable — the in-memory fallback still applies
      }
      return {
        retryPatterns: migrated,
        maxRetriesPerTurn: 10,
      }
    }
    return { retryPatterns: [], maxRetriesPerTurn: 10 }
  }
  try {
    const parsed = JSON.parse(raw)
    return {
      retryPatterns: sanitizeRetryPatterns(Array.isArray(parsed.patterns) ? parsed.patterns : []),
      maxRetriesPerTurn: typeof parsed.maxRetriesPerTurn === 'number' ? parsed.maxRetriesPerTurn : 10,
    }
  } catch {
    return { retryPatterns: [], maxRetriesPerTurn: 10 }
  }
}
