import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  matchRetryPatterns,
  sanitizeRetryPatterns,
  validateRetryPatterns,
  buildRetryPatterns,
  type RetryPatternConfig,
} from './auto-patterns.js'

const { getSettingMock, setSettingMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
  setSettingMock: vi.fn(),
}))

vi.mock('../db/settings.js', () => ({
  getSetting: getSettingMock,
  setSetting: setSettingMock,
  SETTINGS_KEYS: { RETRY_PATTERNS: 'agent.retryPatterns' },
}))

describe('matchRetryPatterns', () => {
  const patterns: RetryPatternConfig[] = [
    { field: 'content', pattern: 'error occurred', action: 'retry', active: true },
    { field: 'thinking', pattern: 'I am unsure', action: 'retry', active: true },
    { field: 'both', pattern: 'cannot complete', action: 'retry', active: true },
  ]

  it('returns empty array when no patterns match', () => {
    const result = matchRetryPatterns('everything is fine', undefined, patterns)
    expect(result).toEqual([])
  })

  it('matches on content field only', () => {
    const result = matchRetryPatterns('an error occurred', undefined, patterns)
    expect(result).toHaveLength(1)
    expect(result[0]!.pattern).toBe('error occurred')
    expect(result[0]!.field).toBe('content')
  })

  it('matches on thinking field only', () => {
    const result = matchRetryPatterns('some content', 'I am unsure about this', patterns)
    expect(result).toHaveLength(1)
    expect(result[0]!.pattern).toBe('I am unsure')
    expect(result[0]!.field).toBe('thinking')
  })

  it('matches on both fields', () => {
    const result = matchRetryPatterns('I cannot complete this', 'I cannot complete', patterns)
    expect(result).toHaveLength(2)
    expect(result[0]!.pattern).toBe('cannot complete')
    expect(result[0]!.field).toBe('both')
  })

  it('matches on both when content matches', () => {
    const result = matchRetryPatterns('I cannot complete this', undefined, patterns)
    expect(result).toHaveLength(1)
  })

  it('matches on both when thinking matches', () => {
    const result = matchRetryPatterns('something else', 'I cannot complete this', patterns)
    expect(result).toHaveLength(1)
  })

  it('ignores inactive patterns', () => {
    const inactivePatterns: RetryPatternConfig[] = [
      { field: 'content', pattern: 'error', action: 'retry', active: false },
    ]
    const result = matchRetryPatterns('an error occurred', undefined, inactivePatterns)
    expect(result).toEqual([])
  })

  it('ignores empty patterns', () => {
    const emptyPatterns: RetryPatternConfig[] = [{ field: 'content', pattern: '', action: 'retry', active: true }]
    const result = matchRetryPatterns('any content', undefined, emptyPatterns)
    expect(result).toEqual([])
  })

  it('ignores whitespace-only patterns', () => {
    const wsPatterns: RetryPatternConfig[] = [{ field: 'both', pattern: '   ', action: 'retry', active: true }]
    const result = matchRetryPatterns('any content', 'any thinking', wsPatterns)
    expect(result).toEqual([])
  })

  it('ignores invalid regex patterns', () => {
    const invalidPatterns: RetryPatternConfig[] = [
      { field: 'content', pattern: '[invalid', action: 'retry', active: true },
    ]
    const result = matchRetryPatterns('an error occurred', undefined, invalidPatterns)
    expect(result).toEqual([])
  })

  it('returns multiple matches when multiple patterns match', () => {
    const multiPatterns: RetryPatternConfig[] = [
      { field: 'content', pattern: 'error', action: 'retry', active: true },
      { field: 'content', pattern: 'failed', action: 'retry', active: true },
      { field: 'thinking', pattern: 'error', action: 'retry', active: true },
    ]
    const result = matchRetryPatterns('error: task failed', 'error in thinking', multiPatterns)
    expect(result).toHaveLength(3)
  })

  it('supports regex patterns', () => {
    const regexPatterns: RetryPatternConfig[] = [
      { field: 'content', pattern: 'err(or|ror)', action: 'retry', active: true },
    ]
    const result = matchRetryPatterns('there was an error', undefined, regexPatterns)
    expect(result).toHaveLength(1)
  })

  it('returns matched content in result', () => {
    const result = matchRetryPatterns('an error occurred', undefined, patterns)
    expect(result[0]!.matchedContent).toBe('an error occurred')
  })

  it('returns matched thinking in result', () => {
    const result = matchRetryPatterns('content', 'I am unsure about this', patterns)
    expect(result[0]!.matchedContent).toBe('I am unsure about this')
  })
})

describe('validateRetryPatterns', () => {
  it('returns no errors for valid patterns', () => {
    const patterns: RetryPatternConfig[] = [{ field: 'content', pattern: 'hello', action: 'retry', active: true }]
    const errors = validateRetryPatterns(patterns)
    expect(errors).toEqual([])
  })

  it('catches invalid regex pattern', () => {
    const patterns: RetryPatternConfig[] = [{ field: 'content', pattern: '[invalid', action: 'retry', active: true }]
    const errors = validateRetryPatterns(patterns)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Invalid regex')
  })

  it('catches unknown field value', () => {
    const patterns = [
      { field: 'unknown', pattern: 'hello', action: 'retry', active: true },
    ] as unknown as RetryPatternConfig[]
    const errors = validateRetryPatterns(patterns)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('field')
  })

  it('catches missing pattern', () => {
    const patterns = [
      { field: 'content', pattern: '', action: 'retry', active: true },
    ] as unknown as RetryPatternConfig[]
    const errors = validateRetryPatterns(patterns)
    expect(errors).toHaveLength(1)
  })

  it('returns multiple errors for multiple invalid patterns', () => {
    const patterns = [
      { field: 'content', pattern: '[invalid', action: 'retry', active: true },
      { field: 'nope', pattern: 'hello', action: 'retry', active: true },
    ] as unknown as RetryPatternConfig[]
    const errors = validateRetryPatterns(patterns)
    expect(errors).toHaveLength(2)
  })
})

describe('sanitizeRetryPatterns', () => {
  it('drops empty and whitespace-only patterns', () => {
    const patterns: RetryPatternConfig[] = [
      { field: 'content', pattern: '', action: 'retry', active: true },
      { field: 'content', pattern: '   ', action: 'retry', active: true },
      { field: 'content', pattern: 'error', action: 'retry', active: true },
    ]
    const result = sanitizeRetryPatterns(patterns)
    expect(result).toHaveLength(1)
    expect(result[0]!.pattern).toBe('error')
  })

  it('drops invalid regex patterns', () => {
    const patterns: RetryPatternConfig[] = [
      { field: 'content', pattern: '[invalid', action: 'retry', active: true },
      { field: 'content', pattern: 'error', action: 'retry', active: true },
    ]
    const result = sanitizeRetryPatterns(patterns)
    expect(result).toHaveLength(1)
    expect(result[0]!.pattern).toBe('error')
  })

  it('keeps valid patterns untouched', () => {
    const patterns: RetryPatternConfig[] = [{ field: 'content', pattern: 'error', action: 'retry', active: true }]
    const result = sanitizeRetryPatterns(patterns)
    expect(result).toEqual(patterns)
  })
})

describe('buildRetryPatterns', () => {
  beforeEach(() => {
    getSettingMock.mockReset().mockReturnValue(null)
    setSettingMock.mockReset()
  })

  it('drops a stored empty pattern when loading', async () => {
    getSettingMock.mockReturnValue(
      JSON.stringify({
        patterns: [
          { field: 'content', pattern: '', action: 'retry', active: true },
          { field: 'content', pattern: 'error', action: 'retry', active: true },
        ],
        maxRetriesPerTurn: 10,
      }),
    )
    const { retryPatterns } = await buildRetryPatterns()
    expect(retryPatterns).toHaveLength(1)
    expect(retryPatterns[0]!.pattern).toBe('error')
  })

  it('drops invalid regex patterns when loading', async () => {
    getSettingMock.mockReturnValue(
      JSON.stringify({
        patterns: [
          { field: 'content', pattern: '[invalid', action: 'retry', active: true },
          { field: 'content', pattern: 'error', action: 'retry', active: true },
        ],
        maxRetriesPerTurn: 10,
      }),
    )
    const { retryPatterns } = await buildRetryPatterns()
    expect(retryPatterns).toHaveLength(1)
    expect(retryPatterns[0]!.pattern).toBe('error')
  })

  it('returns empty patterns for a non-JSON stored value', async () => {
    getSettingMock.mockReturnValue('false')
    const { retryPatterns } = await buildRetryPatterns()
    expect(retryPatterns).toEqual([])
  })

  it('honors the stored maxRetriesPerTurn', async () => {
    getSettingMock.mockReturnValue(
      JSON.stringify({
        patterns: [{ field: 'content', pattern: 'error', action: 'retry', active: true }],
        maxRetriesPerTurn: 3,
      }),
    )
    const { maxRetriesPerTurn } = await buildRetryPatterns()
    expect(maxRetriesPerTurn).toBe(3)
  })

  it('falls back to the XML protection pattern when only the legacy setting exists', async () => {
    getSettingMock.mockImplementation((key: string) =>
      key === 'agent.retryPatterns' ? null : key === 'llm.disableXmlProtection' ? 'false' : null,
    )
    const { retryPatterns, maxRetriesPerTurn } = await buildRetryPatterns()
    expect(retryPatterns).toHaveLength(1)
    expect(retryPatterns[0]!.pattern).toBe('<(tool_call|function=|/tool_call|parameter=)')
    expect(retryPatterns[0]!.field).toBe('both')
    expect(maxRetriesPerTurn).toBe(10)
    // The migrated value is persisted once so the settings UI agrees with the server
    expect(setSettingMock).toHaveBeenCalledTimes(1)
    expect(setSettingMock).toHaveBeenCalledWith(
      'agent.retryPatterns',
      JSON.stringify({
        patterns: [
          {
            field: 'both',
            pattern: '<(tool_call|function=|/tool_call|parameter=)',
            action: 'retry',
            active: true,
          },
        ],
        maxRetriesPerTurn: 10,
      }),
    )
  })

  it('persists an empty pattern list when the legacy protection was explicitly disabled', async () => {
    getSettingMock.mockImplementation((key: string) =>
      key === 'agent.retryPatterns' ? null : key === 'llm.disableXmlProtection' ? 'true' : null,
    )
    const { retryPatterns } = await buildRetryPatterns()
    expect(retryPatterns).toEqual([])
    expect(setSettingMock).toHaveBeenCalledTimes(1)
    expect(setSettingMock).toHaveBeenCalledWith(
      'agent.retryPatterns',
      JSON.stringify({ patterns: [], maxRetriesPerTurn: 10 }),
    )
  })

  it('never persists when a stored row already exists', async () => {
    getSettingMock.mockReturnValue(
      JSON.stringify({ patterns: [{ field: 'content', pattern: 'error', action: 'retry', active: true }] }),
    )
    await buildRetryPatterns()
    expect(setSettingMock).not.toHaveBeenCalled()
  })
})
