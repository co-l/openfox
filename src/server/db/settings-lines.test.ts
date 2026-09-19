/**
 * Line-addressed edits on a newline-joined setting value.
 *
 * The store stays the raw string: a verb may only touch the lines it matched
 * exactly, so headings, blank lines and markdown hard breaks around them come
 * back byte-identical.
 */

import { describe, it, expect } from 'vitest'
import { appendLine, deleteLine, replaceLine, lineCount, validateLine } from './settings-lines.js'

describe('line ops on a settings value', () => {
  describe('validateLine', () => {
    it('rejects empty, whitespace-only and multi-line input', () => {
      expect(validateLine('')).toMatch(/required/i)
      expect(validateLine('   ')).toMatch(/required/i)
      expect(validateLine('a\nb')).toMatch(/single line/i)
      expect(validateLine('a\rb')).toMatch(/single line/i)
      expect(validateLine('one clean line')).toBeNull()
      expect(validateLine('  trimmed ok  ')).toBeNull()
    })
  })

  describe('appendLine', () => {
    it('adds the line after the last content line', () => {
      const r = appendLine('alpha\nbeta', 'gamma')
      expect(r).toMatchObject({ changed: true, matched: 0, lineCount: 3 })
      expect(r.value).toBe('alpha\nbeta\ngamma')
      expect(r.added).toEqual(['gamma'])
      expect(r.removed).toEqual([])
      expect(r.message).toMatch(/Appended 1 line \(3 total\)/)
    })

    it('keeps a trailing newline where it was', () => {
      expect(appendLine('alpha\nbeta\n', 'gamma').value).toBe('alpha\nbeta\ngamma\n')
      expect(appendLine('alpha\n\n', 'gamma').value).toBe('alpha\ngamma\n\n')
    })

    it('fills an empty store without stray newlines', () => {
      expect(appendLine('', 'gamma').value).toBe('gamma')
      expect(appendLine('  \n', 'gamma').value).toBe('gamma')
    })

    it('is idempotent on an identical line', () => {
      const value = 'alpha\nbeta'
      const r = appendLine(value, 'beta')
      expect(r).toMatchObject({ changed: false, matched: 1, lineCount: 2 })
      expect(r.value).toBe(value)
      expect(r.added).toEqual([])
      expect(r.message).toMatch(/already present/i)
    })

    it('matches whole lines only', () => {
      const r = appendLine('alpha beta gamma', 'beta')
      expect(r.changed).toBe(true)
      expect(r.value).toBe('alpha beta gamma\nbeta')
    })
  })

  describe('replaceLine', () => {
    it('replaces every exact match and leaves the rest untouched', () => {
      const value = '## Section\n\n- keep me\n- change me\n\n- change me'
      const r = replaceLine(value, '- change me', '- changed')
      expect(r).toMatchObject({ changed: true, matched: 2, lineCount: 4 })
      expect(r.removed).toEqual(['- change me', '- change me'])
      expect(r.added).toEqual(['- changed', '- changed'])
      expect(r.value).toBe('## Section\n\n- keep me\n- changed\n\n- changed')
      expect(r.message).toMatch(/Replaced 2 occurrence\(s\)/)
    })

    it('compares ignoring surrounding whitespace', () => {
      const r = replaceLine('alpha  \nbeta', '  alpha', 'ALPHA')
      expect(r.matched).toBe(1)
      expect(r.value).toBe('ALPHA\nbeta')
    })

    it('reports no match without touching the value', () => {
      const r = replaceLine('alpha\nbeta', 'nope', 'x')
      expect(r).toMatchObject({ changed: false, matched: 0, value: 'alpha\nbeta' })
      expect(r.message).toMatch(/No line matched/i)
    })
  })

  describe('deleteLine', () => {
    it('removes every exact match and keeps structure around it', () => {
      const value = '# Head\n\nkeep\nremove\n\nremove\nlast'
      const r = deleteLine(value, 'remove')
      expect(r).toMatchObject({ changed: true, matched: 2, lineCount: 3 })
      expect(r.removed).toEqual(['remove', 'remove'])
      expect(r.added).toEqual([])
      expect(r.value).toBe('# Head\n\nkeep\n\nlast')
      expect(r.message).toMatch(/Removed 2 line\(s\)/)
    })

    it('refuses to address blank lines', () => {
      const r = deleteLine('a\n\nb', '   ')
      expect(r).toMatchObject({ changed: false, matched: 0, value: 'a\n\nb' })
      expect(r.message).toMatch(/blank line/i)
    })

    it('reports no match without touching the value', () => {
      const r = deleteLine('alpha', 'nope')
      expect(r).toMatchObject({ changed: false, matched: 0, value: 'alpha' })
    })
  })

  describe('lineCount', () => {
    it('counts content lines only', () => {
      expect(lineCount('')).toBe(0)
      expect(lineCount('\n\n  \n')).toBe(0)
      expect(lineCount('a\nb\n')).toBe(2)
    })
  })
})
