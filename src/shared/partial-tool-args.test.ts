// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parsePartialFileArgs } from './partial-tool-args.js'

describe('parsePartialFileArgs', () => {
  it('returns empty object for undefined or empty input', () => {
    expect(parsePartialFileArgs(undefined)).toEqual({})
    expect(parsePartialFileArgs('')).toEqual({})
    expect(parsePartialFileArgs('{')).toEqual({})
  })

  it('parses complete JSON arguments', () => {
    expect(parsePartialFileArgs(JSON.stringify({ path: 'src/a.ts', content: 'const x = 1' }))).toEqual({
      path: 'src/a.ts',
      content: 'const x = 1',
    })
  })

  it('extracts path and partial content from a streamed fragment', () => {
    expect(parsePartialFileArgs('{"path":"src/app.ts","content":"const x = 1')).toEqual({
      path: 'src/app.ts',
      content: 'const x = 1',
    })
  })

  it('progressively unescapes JSON string escapes in the content', () => {
    expect(parsePartialFileArgs('{"path":"src/a.ts","content":"line1\\nline2')).toEqual({
      path: 'src/a.ts',
      content: 'line1\nline2',
    })
  })

  it('stops at an incomplete escape sequence at the end of the fragment', () => {
    expect(parsePartialFileArgs('{"path":"src/a.ts","content":"line1\\')).toEqual({
      path: 'src/a.ts',
      content: 'line1',
    })
  })

  it('handles escaped quotes and backslashes in the content', () => {
    expect(parsePartialFileArgs('{"path":"src/a.ts","content":"say \\"hi\\" \\\\end')).toEqual({
      path: 'src/a.ts',
      content: 'say "hi" \\end',
    })
  })

  it('decodes complete unicode escapes', () => {
    expect(parsePartialFileArgs('{"path":"src/a.ts","content":"caf\\u00e9')).toEqual({
      path: 'src/a.ts',
      content: 'café',
    })
  })

  it('extracts old_string and new_string for edit_file', () => {
    expect(parsePartialFileArgs('{"path":"src/a.ts","old_string":"const x = 1","new_string":"const x')).toEqual({
      path: 'src/a.ts',
      old_string: 'const x = 1',
      new_string: 'const x',
    })
  })

  it('returns only what is present when the value is empty', () => {
    const result = parsePartialFileArgs('{"path":"src/a.ts","content":""}')
    expect(result.path).toBe('src/a.ts')
    expect(result.content).toBe('')
  })

  it('returns undefined fields when keys are not yet streamed', () => {
    expect(parsePartialFileArgs('{"path":"src/a.ts"')).toEqual({ path: 'src/a.ts' })
  })

  it('extracts replace_all from complete JSON', () => {
    expect(
      parsePartialFileArgs(JSON.stringify({ path: 'src/a.ts', old_string: 'x', new_string: 'y', replace_all: true })),
    ).toEqual({ path: 'src/a.ts', old_string: 'x', new_string: 'y', replace_all: true })
  })

  it('extracts replace_all from a partial fragment', () => {
    expect(parsePartialFileArgs('{"path":"src/a.ts","old_string":"x","replace_all":true')).toEqual({
      path: 'src/a.ts',
      old_string: 'x',
      replace_all: true,
    })
  })
})
