import { describe, it, expect } from 'vitest'
import { matchAutoPatterns, type AutoPattern } from './auto-patterns.js'

describe('matchAutoPatterns', () => {
  it('returns empty array when no patterns match', () => {
    const patterns: AutoPattern[] = [{ match: /hello/, response: 'Hi there!' }]

    const result = matchAutoPatterns('goodbye', undefined, patterns)

    expect(result).toEqual([])
  })

  it('returns match when pattern matches content', () => {
    const patterns: AutoPattern[] = [{ match: /hello/, response: 'Hi there!' }]

    const result = matchAutoPatterns('hello world', undefined, patterns)

    expect(result).toHaveLength(1)
    expect(result[0]?.response).toBe('Hi there!')
  })

  it('returns match when pattern matches thinking', () => {
    const patterns: AutoPattern[] = [{ match: /think/, response: 'Stop thinking' }]

    const result = matchAutoPatterns('content', 'I think therefore', patterns)

    expect(result).toHaveLength(1)
  })

  it('returns all matching patterns', () => {
    const patterns: AutoPattern[] = [
      { match: /hello/, response: 'Hi' },
      { match: /world/, response: 'Earth' },
      { match: /foo/, response: 'Bar' },
    ]

    const result = matchAutoPatterns('hello world', undefined, patterns)

    expect(result).toHaveLength(2)
    expect(result[0]?.response).toBe('Hi')
    expect(result[1]?.response).toBe('Earth')
  })

  it('supports function-based matchers', () => {
    const patterns: AutoPattern[] = [
      { match: (content: string) => content.includes('error'), response: 'Fix the error' },
    ]

    const result = matchAutoPatterns('something error happened', undefined, patterns)

    expect(result).toHaveLength(1)
    expect(result[0]?.response).toBe('Fix the error')
  })

  it('returns empty for function matcher that returns false', () => {
    const patterns: AutoPattern[] = [{ match: (content: string) => content.includes('xyz'), response: 'Nope' }]

    const result = matchAutoPatterns('hello', undefined, patterns)

    expect(result).toEqual([])
  })

  it('supports context-based matchers', () => {
    const patterns: AutoPattern[] = [
      {
        match: (_content: string, _thinking?: string, context?: { xmlFormatError?: boolean }) =>
          context?.xmlFormatError === true,
        response: 'Use JSON format',
      },
    ]

    const result = matchAutoPatterns('some content', undefined, patterns, { xmlFormatError: true })

    expect(result).toHaveLength(1)
    expect(result[0]?.response).toBe('Use JSON format')
  })

  it('does not match context-based pattern when context is absent', () => {
    const patterns: AutoPattern[] = [
      {
        match: (_content: string, _thinking?: string, context?: { xmlFormatError?: boolean }) =>
          context?.xmlFormatError === true,
        response: 'Use JSON format',
      },
    ]

    const result = matchAutoPatterns('some content', undefined, patterns)

    expect(result).toEqual([])
  })
})
