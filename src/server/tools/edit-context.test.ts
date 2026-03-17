import { describe, it, expect } from 'vitest'
import { extractEditContext, type EditRegion } from './edit-context.js'

describe('extractEditContext', () => {
  const sampleFile = `line 1
line 2
line 3
line 4
line 5
line 6
line 7
line 8
line 9
line 10
target line
line 12
line 13
line 14
line 15
line 16
line 17
line 18
line 19
line 20`

  describe('single replacement', () => {
    it('extracts 4 lines before and after with line numbers', () => {
      const result = extractEditContext(sampleFile, 'target line', 'new line')
      
      expect(result.regions).toHaveLength(1)
      const region = result.regions[0]!
      
      // Should have 4 lines of context before
      expect(region.beforeContext).toHaveLength(4)
      expect(region.beforeContext[0]).toEqual({ lineNumber: 7, content: 'line 7' })
      expect(region.beforeContext[3]).toEqual({ lineNumber: 10, content: 'line 10' })
      
      // The edit itself
      expect(region.startLine).toBe(11)
      expect(region.oldContent).toBe('target line')
      expect(region.newContent).toBe('new line')
      
      // Should have 4 lines of context after
      expect(region.afterContext).toHaveLength(4)
      expect(region.afterContext[0]).toEqual({ lineNumber: 12, content: 'line 12' })
      expect(region.afterContext[3]).toEqual({ lineNumber: 15, content: 'line 15' })
    })

    it('handles edit at start of file (less than 4 lines before)', () => {
      const content = `first line
second line
third line`
      const result = extractEditContext(content, 'first line', 'new first')
      
      expect(result.regions).toHaveLength(1)
      const region = result.regions[0]!
      
      expect(region.beforeContext).toHaveLength(0)
      expect(region.startLine).toBe(1)
      expect(region.afterContext).toHaveLength(2)
      expect(region.afterContext[0]).toEqual({ lineNumber: 2, content: 'second line' })
    })

    it('handles edit at end of file (less than 4 lines after)', () => {
      const content = `line 1
line 2
last line`
      const result = extractEditContext(content, 'last line', 'new last')
      
      expect(result.regions).toHaveLength(1)
      const region = result.regions[0]!
      
      expect(region.beforeContext).toHaveLength(2)
      expect(region.afterContext).toHaveLength(0)
      expect(region.startLine).toBe(3)
    })

    it('handles multi-line old_string', () => {
      const content = `before
start of edit
middle of edit
end of edit
after`
      const result = extractEditContext(
        content,
        'start of edit\nmiddle of edit\nend of edit',
        'single replacement line'
      )
      
      expect(result.regions).toHaveLength(1)
      const region = result.regions[0]!
      
      expect(region.startLine).toBe(2)
      expect(region.endLine).toBe(4)
      expect(region.beforeContext).toHaveLength(1)
      expect(region.beforeContext[0]).toEqual({ lineNumber: 1, content: 'before' })
      expect(region.afterContext).toHaveLength(1)
      expect(region.afterContext[0]).toEqual({ lineNumber: 5, content: 'after' })
    })
  })

  describe('multiple replacements (replace_all)', () => {
    it('creates separate regions for non-overlapping edits', () => {
      const content = `line 1
line 2
target
line 4
line 5
line 6
line 7
line 8
line 9
line 10
line 11
line 12
line 13
line 14
line 15
line 16
line 17
line 18
line 19
line 20
target
line 22`
      
      const result = extractEditContext(content, 'target', 'replaced', true)
      
      expect(result.regions).toHaveLength(2)
      expect(result.regions[0]!.startLine).toBe(3)
      expect(result.regions[1]!.startLine).toBe(21)
    })

    it('merges overlapping context regions', () => {
      // Two targets only 5 lines apart - their contexts should merge
      const content = `line 1
line 2
first target
line 4
line 5
line 6
line 7
second target
line 9
line 10`
      
      const result = extractEditContext(content, 'target', 'replaced', true)
      
      // Should merge into a single region since contexts overlap
      expect(result.regions).toHaveLength(1)
      const region = result.regions[0]!
      
      // The merged region should span both edits
      expect(region.edits).toHaveLength(2)
      expect(region.edits[0]!.startLine).toBe(3)
      expect(region.edits[1]!.startLine).toBe(8)
      
      // Context before first edit
      expect(region.beforeContext).toHaveLength(2)
      expect(region.beforeContext[0]).toEqual({ lineNumber: 1, content: 'line 1' })
      
      // Context after last edit
      expect(region.afterContext).toHaveLength(2)
      expect(region.afterContext[0]).toEqual({ lineNumber: 9, content: 'line 9' })
    })

    it('handles adjacent edits without duplicating lines between them', () => {
      const content = `line 1
target
target
line 4`
      
      const result = extractEditContext(content, 'target', 'replaced', true)
      
      // Adjacent edits should be in one region
      expect(result.regions).toHaveLength(1)
      expect(result.regions[0]!.edits).toHaveLength(2)
    })
  })

  describe('edge cases', () => {
    it('handles empty file', () => {
      const result = extractEditContext('', 'target', 'new')
      expect(result.regions).toHaveLength(0)
    })

    it('handles no matches', () => {
      const result = extractEditContext('some content', 'not found', 'new')
      expect(result.regions).toHaveLength(0)
    })

    it('handles edit that spans entire file', () => {
      const content = 'entire file'
      const result = extractEditContext(content, 'entire file', 'new content')
      
      expect(result.regions).toHaveLength(1)
      expect(result.regions[0]!.beforeContext).toHaveLength(0)
      expect(result.regions[0]!.afterContext).toHaveLength(0)
    })
  })
})
