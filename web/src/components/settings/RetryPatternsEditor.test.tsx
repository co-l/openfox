/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { isValidRegex, RetryPatternsEditor, type RetryPatternsValue } from './RetryPatternsEditor'

describe('isValidRegex', () => {
  it('returns true for valid regex', () => {
    expect(isValidRegex('hello')).toBe(true)
    expect(isValidRegex('\\d+')).toBe(true)
    expect(isValidRegex('(foo|bar)')).toBe(true)
  })

  it('returns false for invalid regex', () => {
    expect(isValidRegex('[invalid')).toBe(false)
    expect(isValidRegex('(unclosed')).toBe(false)
  })

  it('returns false for empty or whitespace-only pattern', () => {
    expect(isValidRegex('')).toBe(false)
    expect(isValidRegex('   ')).toBe(false)
  })
})

describe('RetryPatternsEditor', () => {
  const value: RetryPatternsValue = {
    patterns: [{ field: 'content', pattern: '', action: 'retry', active: true }],
    maxRetriesPerTurn: 10,
  }

  it('shows no validity marker for an untouched empty pattern', () => {
    const { container } = render(<RetryPatternsEditor value={value} onChange={vi.fn()} />)
    expect(container.textContent).not.toContain('✗')
    expect(container.textContent).not.toContain('✓')
  })

  it('marks a valid pattern as valid', () => {
    const valid: RetryPatternsValue = {
      ...value,
      patterns: [{ field: 'content', pattern: 'error', action: 'retry', active: true }],
    }
    const { container } = render(<RetryPatternsEditor value={valid} onChange={vi.fn()} />)
    expect(container.textContent).toContain('✓')
  })

  it('marks an invalid non-empty pattern as invalid', () => {
    const invalid: RetryPatternsValue = {
      ...value,
      patterns: [{ field: 'content', pattern: '[invalid', action: 'retry', active: true }],
    }
    const { container } = render(<RetryPatternsEditor value={invalid} onChange={vi.fn()} />)
    expect(container.textContent).toContain('✗')
  })

  it('shows a hint that invalid patterns are not saved', () => {
    const { container } = render(<RetryPatternsEditor value={value} onChange={vi.fn()} />)
    expect(container.textContent).toMatch(/not saved|non sauvegardés/i)
  })
})
