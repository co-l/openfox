import { describe, it, expect } from 'vitest'
import {
  computeUnifiedDiff,
  computeDynamicContextHash,
  computeToolDiff,
  computePreviewToolDiff,
} from './dynamic-context.js'

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

describe('computeToolDiff', () => {
  const tool = (name: string) => ({
    type: 'function' as const,
    function: { name, description: `desc ${name}`, parameters: { type: 'object', properties: {} } },
  })

  it('returns empty array when tool sets are identical', () => {
    const tools = [tool('read_file'), tool('write_file')]
    expect(computeToolDiff(tools, [...tools])).toEqual([])
  })

  it('detects removed tools', () => {
    const oldTools = [tool('read_file'), tool('write_file')]
    const newTools = [tool('read_file')]
    expect(computeToolDiff(oldTools, newTools)).toEqual([{ type: 'removed', content: 'write_file' }])
  })

  it('detects added tools', () => {
    const oldTools = [tool('read_file')]
    const newTools = [tool('read_file'), tool('write_file')]
    expect(computeToolDiff(oldTools, newTools)).toEqual([{ type: 'added', content: 'write_file' }])
  })

  it('detects both additions and removals with removals first', () => {
    const oldTools = [tool('a'), tool('b')]
    const newTools = [tool('b'), tool('c')]
    expect(computeToolDiff(oldTools, newTools)).toEqual([
      { type: 'removed', content: 'a' },
      { type: 'added', content: 'c' },
    ])
  })
})

describe('computePreviewToolDiff', () => {
  const tool = (name: string) => ({
    type: 'function' as const,
    function: { name, description: `desc ${name}`, parameters: { type: 'object', properties: {} } },
  })

  it('uses cached tools as baseline when a cached prompt exists', () => {
    const cached = [tool('read_file'), tool('write_file')]
    const unfiltered = [tool('read_file'), tool('write_file'), tool('chrome_click')]
    const fresh = [tool('read_file'), tool('write_file')]
    expect(computePreviewToolDiff(cached, unfiltered, fresh)).toEqual([])
  })

  it('uses cached tools as baseline and detects removals when MCP is toggled off', () => {
    const cached = [tool('read_file'), tool('chrome_click')]
    const unfiltered = [tool('read_file'), tool('chrome_click')]
    const fresh = [tool('read_file')]
    expect(computePreviewToolDiff(cached, unfiltered, fresh)).toEqual([{ type: 'removed', content: 'chrome_click' }])
  })

  it('falls back to unfiltered registry when no cached prompt exists', () => {
    const unfiltered = [tool('read_file'), tool('chrome_click')]
    const fresh = [tool('read_file')]
    expect(computePreviewToolDiff(undefined, unfiltered, fresh)).toEqual([{ type: 'removed', content: 'chrome_click' }])
  })

  it('falls back to unfiltered registry when cached tools are empty', () => {
    const unfiltered = [tool('read_file'), tool('chrome_click')]
    const fresh = [tool('read_file')]
    expect(computePreviewToolDiff([], unfiltered, fresh)).toEqual([{ type: 'removed', content: 'chrome_click' }])
  })

  it('reports no additions without a cached prompt since the baseline already includes all MCP tools', () => {
    const unfiltered = [tool('read_file'), tool('chrome_click')]
    const fresh = [tool('read_file'), tool('chrome_click')]
    expect(computePreviewToolDiff(undefined, unfiltered, fresh)).toEqual([])
  })

  it('detects additions when a cached prompt was built with MCP off and it is toggled on', () => {
    const cached = [tool('read_file')]
    const unfiltered = [tool('read_file'), tool('chrome_click')]
    const fresh = [tool('read_file'), tool('chrome_click')]
    expect(computePreviewToolDiff(cached, unfiltered, fresh)).toEqual([{ type: 'added', content: 'chrome_click' }])
  })

  it('reports no change when both baselines match the fresh tool set', () => {
    const unfiltered = [tool('read_file')]
    expect(computePreviewToolDiff(undefined, unfiltered, [tool('read_file')])).toEqual([])
  })
})

describe('computeDynamicContextHash', () => {
  const skills = [{ id: 'playwright', name: 'Playwright', description: 'Browser automation', version: '1.0' }]

  it('produces consistent hash for same inputs', () => {
    const a = computeDynamicContextHash('do foo', skills, 'tool-fp')
    const b = computeDynamicContextHash('do foo', skills, 'tool-fp')
    expect(a).toBe(b)
  })

  it('produces different hash for different instructions', () => {
    const a = computeDynamicContextHash('do foo', skills, 'tool-fp')
    const b = computeDynamicContextHash('do bar', skills, 'tool-fp')
    expect(a).not.toBe(b)
  })

  it('includes modelName in hash when provided', () => {
    const withoutModel = computeDynamicContextHash('do foo', skills, 'tool-fp')
    const withModel = computeDynamicContextHash('do foo', skills, 'tool-fp', 'MiniMax-M2.7')
    expect(withModel).not.toBe(withoutModel)
  })

  it('produces consistent hash for same modelName', () => {
    const a = computeDynamicContextHash('do foo', skills, 'tool-fp', 'MiniMax-M2.7')
    const b = computeDynamicContextHash('do foo', skills, 'tool-fp', 'MiniMax-M2.7')
    expect(a).toBe(b)
  })

  it('differentiates between different modelNames', () => {
    const a = computeDynamicContextHash('do foo', skills, 'tool-fp', 'MiniMax-M2.7')
    const b = computeDynamicContextHash('do foo', skills, 'tool-fp', 'gpt-4o')
    expect(a).not.toBe(b)
  })

  it('omitting modelName produces same hash as before feature existed', () => {
    const a = computeDynamicContextHash('do foo', skills, 'tool-fp')
    const b = computeDynamicContextHash('do foo', skills, 'tool-fp', undefined)
    expect(a).toBe(b)
  })
})
