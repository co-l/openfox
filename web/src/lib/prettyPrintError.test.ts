import { describe, expect, it } from 'vitest'
import { prettyPrintError } from './prettyPrintError'

describe('prettyPrintError', () => {
  it('returns plain text unchanged', () => {
    expect(prettyPrintError('HTTP 500: Internal Server Error')).toBe('HTTP 500: Internal Server Error')
  })

  it('preserves multi-line plain text', () => {
    const error = 'line one\nline two\n  indented'
    expect(prettyPrintError(error)).toBe(error)
  })

  it('pretty-prints a JSON object error', () => {
    expect(prettyPrintError('{"error":{"code":"rate_limit","message":"slow down"}}')).toBe(
      '{\n  "error": {\n    "code": "rate_limit",\n    "message": "slow down"\n  }\n}',
    )
  })

  it('pretty-prints a JSON array error', () => {
    expect(prettyPrintError('[{"a":1},{"b":2}]')).toBe('[\n  {\n    "a": 1\n  },\n  {\n    "b": 2\n  }\n]')
  })

  it('unquotes a JSON string literal', () => {
    expect(prettyPrintError('"boom"')).toBe('boom')
  })

  it('returns an empty string as-is', () => {
    expect(prettyPrintError('')).toBe('')
  })
})
