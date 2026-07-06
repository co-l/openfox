import { describe, it, expect } from 'vitest'
import { getAtMentionAtCursor } from '../lib/atMention'

describe('getAtMentionAtCursor', () => {
  it('returns null when there is no @ in the text', () => {
    expect(getAtMentionAtCursor('hello world', 11)).toBeNull()
  })

  it('returns null when @ is at the start but cursor is before it', () => {
    expect(getAtMentionAtCursor('@file.ts', 0)).toBeNull()
  })

  it('returns query and startIndex for @ at the start of text', () => {
    const result = getAtMentionAtCursor('@file.ts', 8)
    expect(result).toEqual({ query: 'file.ts', startIndex: 0 })
  })

  it('returns query and startIndex for @ in the middle of text', () => {
    const result = getAtMentionAtCursor('Read @file.ts', 13)
    expect(result).toEqual({ query: 'file.ts', startIndex: 5 })
  })

  it('returns query and startIndex for @ on a new line', () => {
    const result = getAtMentionAtCursor('Hello\n@file.ts', 14)
    expect(result).toEqual({ query: 'file.ts', startIndex: 6 })
  })

  it('returns null when there is a space after @', () => {
    const result = getAtMentionAtCursor('@ file.ts', 10)
    expect(result).toBeNull()
  })

  it('returns null when there is a newline after @', () => {
    const result = getAtMentionAtCursor('@\nfile.ts', 10)
    expect(result).toBeNull()
  })

  it('returns null when there is a tab after @', () => {
    const result = getAtMentionAtCursor('@\tfile.ts', 10)
    expect(result).toBeNull()
  })

  it('returns query for just @', () => {
    const result = getAtMentionAtCursor('@', 1)
    expect(result).toEqual({ query: '', startIndex: 0 })
  })

  it('returns query for partial filename', () => {
    const result = getAtMentionAtCursor('Read @src/index', 16)
    expect(result).toEqual({ query: 'src/index', startIndex: 5 })
  })

  it('returns null when @ is after a newline but cursor is before it', () => {
    const result = getAtMentionAtCursor('Hello\n@file.ts', 6)
    expect(result).toBeNull()
  })
  it('returns null when the query has a trailing space (post-selection state)', () => {
    // After selecting a file the input becomes "@README.md " with the cursor
    // past the trailing space; the space in the query must close the popup.
    const result = getAtMentionAtCursor('@README.md ', 11)
    expect(result).toBeNull()
  })

  it('keeps a valid query when it contains a slash (directory navigation)', () => {
    // After selecting a directory the input becomes "@src/" with the cursor after
    // the slash; the slash must NOT terminate the mention, so the popup stays open.
    const result = getAtMentionAtCursor('@src/', 5)
    expect(result).toEqual({ query: 'src/', startIndex: 0 })
  })

  it('uses the last @ when multiple @ are present', () => {
    const result = getAtMentionAtCursor('see @foo and @bar', 18)
    expect(result).toEqual({ query: 'bar', startIndex: 13 })
  })
})
