export interface AutoPatternMatchContext {
  xmlFormatError?: boolean
}

export interface AutoPattern {
  match: RegExp | ((content: string, thinking?: string, context?: AutoPatternMatchContext) => boolean)
  response: string
}

export interface AutoMatch {
  response: string
}

export function matchAutoPatterns(
  content: string,
  thinking: string | undefined,
  patterns: AutoPattern[],
  context?: AutoPatternMatchContext,
): AutoMatch[] {
  const matches: AutoMatch[] = []

  for (const pattern of patterns) {
    const matched =
      pattern.match instanceof RegExp
        ? pattern.match.test(content) || (thinking !== undefined && pattern.match.test(thinking))
        : pattern.match(content, thinking, context)
    if (matched) {
      matches.push({ response: pattern.response })
    }
  }

  return matches
}
