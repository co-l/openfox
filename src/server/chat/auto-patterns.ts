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
