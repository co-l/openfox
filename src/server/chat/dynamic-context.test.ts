import { describe, it, expect } from 'vitest'
import { computeUnifiedDiff } from './dynamic-context.js'

describe('computeUnifiedDiff', () => {
  it('returns unchanged lines when texts are identical', () => {
    const oldText = 'line1\nline2\nline3'
    const newText = 'line1\nline2\nline3'

    const result = computeUnifiedDiff(oldText, newText)

    expect(result).toEqual([
      { type: 'unchanged', content: 'line1' },
      { type: 'unchanged', content: 'line2' },
      { type: 'unchanged', content: 'line3' },
    ])
  })

  it('detects a single line removal', () => {
    const oldText = 'line1\nline2\nline3'
    const newText = 'line1\nline3'

    const result = computeUnifiedDiff(oldText, newText)

    expect(result).toEqual([
      { type: 'unchanged', content: 'line1' },
      { type: 'removed', content: 'line2' },
      { type: 'unchanged', content: 'line3' },
    ])
  })

  it('detects a single line addition', () => {
    const oldText = 'line1\nline3'
    const newText = 'line1\nline2\nline3'

    const result = computeUnifiedDiff(oldText, newText)

    expect(result).toEqual([
      { type: 'unchanged', content: 'line1' },
      { type: 'added', content: 'line2' },
      { type: 'unchanged', content: 'line3' },
    ])
  })

  it('detects a line replacement (removed then added)', () => {
    const oldText = 'line1\nold line\nline3'
    const newText = 'line1\nnew line\nline3'

    const result = computeUnifiedDiff(oldText, newText)

    expect(result).toEqual([
      { type: 'unchanged', content: 'line1' },
      { type: 'removed', content: 'old line' },
      { type: 'added', content: 'new line' },
      { type: 'unchanged', content: 'line3' },
    ])
  })

  it('handles multiple consecutive removals', () => {
    const oldText = 'line1\nline2\nline3\nline4\nline5'
    const newText = 'line1\nline5'

    const result = computeUnifiedDiff(oldText, newText)

    expect(result).toEqual([
      { type: 'unchanged', content: 'line1' },
      { type: 'removed', content: 'line2' },
      { type: 'removed', content: 'line3' },
      { type: 'removed', content: 'line4' },
      { type: 'unchanged', content: 'line5' },
    ])
  })

  it('handles multiple consecutive additions', () => {
    const oldText = 'line1\nline5'
    const newText = 'line1\nline2\nline3\nline4\nline5'

    const result = computeUnifiedDiff(oldText, newText)

    expect(result).toEqual([
      { type: 'unchanged', content: 'line1' },
      { type: 'added', content: 'line2' },
      { type: 'added', content: 'line3' },
      { type: 'added', content: 'line4' },
      { type: 'unchanged', content: 'line5' },
    ])
  })

  it('handles complex changes with multiple sections', () => {
    const oldText = `# System Prompt
You are a helpful assistant.
Respond concisely.

## Guidelines
- Be polite
- Be accurate`

    const newText = `# System Prompt
You are a helpful and friendly assistant.
Respond concisely and clearly.

## Guidelines
- Be polite
- Be accurate
- Be helpful`

    const result = computeUnifiedDiff(oldText, newText)

    const removedLines = result.filter((d) => d.type === 'removed').map((d) => d.content)
    const addedLines = result.filter((d) => d.type === 'added').map((d) => d.content)

    expect(removedLines).toContain('You are a helpful assistant.')
    expect(addedLines).toContain('You are a helpful and friendly assistant.')
    expect(addedLines).toContain('Respond concisely and clearly.')
    expect(addedLines).toContain('- Be helpful')
  })

  it('handles empty old text (all additions)', () => {
    const oldText = ''
    const newText = 'line1\nline2'

    const result = computeUnifiedDiff(oldText, newText)

    expect(result).toEqual([
      { type: 'added', content: 'line1' },
      { type: 'added', content: 'line2' },
    ])
  })

  it('handles empty new text (all removals)', () => {
    const oldText = 'line1\nline2'
    const newText = ''

    const result = computeUnifiedDiff(oldText, newText)

    expect(result).toEqual([
      { type: 'removed', content: 'line1' },
      { type: 'removed', content: 'line2' },
    ])
  })

  it('prefers removals before additions at the same position', () => {
    const oldText = 'a\nb\nc'
    const newText = 'a\nc\nd'

    const result = computeUnifiedDiff(oldText, newText)

    // b is removed, then d is added
    const removedIndex = result.findIndex((d) => d.content === 'b' && d.type === 'removed')
    const addedIndex = result.findIndex((d) => d.content === 'd' && d.type === 'added')

    expect(removedIndex).toBeGreaterThan(-1)
    expect(addedIndex).toBeGreaterThan(-1)
    expect(removedIndex).toBeLessThan(addedIndex)
  })

  it('handles empty lines correctly', () => {
    const oldText = 'line1\n\nline3'
    const newText = 'line1\nline3'

    const result = computeUnifiedDiff(oldText, newText)

    expect(result).toEqual([
      { type: 'unchanged', content: 'line1' },
      { type: 'removed', content: '' },
      { type: 'unchanged', content: 'line3' },
    ])
  })

  it('handles single line changes', () => {
    const oldText = 'old'
    const newText = 'new'

    const result = computeUnifiedDiff(oldText, newText)

    expect(result).toEqual([
      { type: 'removed', content: 'old' },
      { type: 'added', content: 'new' },
    ])
  })
})
