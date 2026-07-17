import { describe, it, expect } from 'vitest'
import { metadataKeyLabels, formatMetadataKeyLabel, formatMetadataKeyLabelLower } from './metadata-keys'

describe('metadataKeyLabels', () => {
  it('contains known keys', () => {
    expect(metadataKeyLabels['criteria']).toBe('Acceptance Criteria')
    expect(metadataKeyLabels['review_findings']).toBe('Review Findings')
    expect(metadataKeyLabels['todos']).toBe('Tasks')
  })
})

describe('formatMetadataKeyLabel', () => {
  it('returns known label for known keys', () => {
    expect(formatMetadataKeyLabel('criteria')).toBe('Acceptance Criteria')
    expect(formatMetadataKeyLabel('review_findings')).toBe('Review Findings')
    expect(formatMetadataKeyLabel('todos')).toBe('Tasks')
  })

  it('formats unknown keys by capitalizing first letter of each word', () => {
    expect(formatMetadataKeyLabel('qa_findings')).toBe('Qa Findings')
    expect(formatMetadataKeyLabel('custom_key')).toBe('Custom Key')
    expect(formatMetadataKeyLabel('single')).toBe('Single')
    expect(formatMetadataKeyLabel('ui_tests')).toBe('Ui Tests')
  })

  it('safely handles reserved JS property names', () => {
    expect(formatMetadataKeyLabel('toString')).toBe('ToString')
    expect(formatMetadataKeyLabel('constructor')).toBe('Constructor')
    expect(() => formatMetadataKeyLabel('__proto__')).not.toThrow()
  })
})

describe('formatMetadataKeyLabelLower', () => {
  it('returns lowercase label for known keys', () => {
    expect(formatMetadataKeyLabelLower('criteria')).toBe('criteria')
    expect(formatMetadataKeyLabelLower('review_findings')).toBe('review findings')
    expect(formatMetadataKeyLabelLower('todos')).toBe('tasks')
  })

  it('replaces underscores with spaces for unknown keys', () => {
    expect(formatMetadataKeyLabelLower('qa_findings')).toBe('qa findings')
    expect(formatMetadataKeyLabelLower('custom_key')).toBe('custom key')
    expect(formatMetadataKeyLabelLower('single')).toBe('single')
  })

  it('safely handles reserved JS property names', () => {
    expect(formatMetadataKeyLabelLower('toString')).toBe('toString')
    expect(formatMetadataKeyLabelLower('constructor')).toBe('constructor')
    expect(() => formatMetadataKeyLabelLower('__proto__')).not.toThrow()
  })
})
