import { describe, it, expect } from 'vitest'
import { renderToolResultContent } from './tool-result-content.js'

describe('renderToolResultContent', () => {
  it('returns the output verbatim on success', () => {
    expect(renderToolResultContent({ success: true, output: 'build ok\n\n[Exit code: 0]\n[Duration: 4.2s]' })).toBe(
      'build ok\n\n[Exit code: 0]\n[Duration: 4.2s]',
    )
  })

  it('falls back to "Success" on success without output', () => {
    expect(renderToolResultContent({ success: true })).toBe('Success')
  })

  it('appends the error line on failure with output and error', () => {
    expect(renderToolResultContent({ success: false, output: 'partial', error: 'Command exited with code 1' })).toBe(
      'partial\n\nError: Command exited with code 1',
    )
  })

  it('appends an empty error line on failure with output but no error (no "undefined")', () => {
    expect(renderToolResultContent({ success: false, output: 'partial' })).toBe('partial\n\nError: ')
  })

  it('renders just the error when there is no output', () => {
    expect(renderToolResultContent({ success: false, error: 'File not found' })).toBe('Error: File not found')
    expect(renderToolResultContent({ success: false })).toBe('Error: ')
  })

  it('strips ANSI sequences', () => {
    expect(renderToolResultContent({ success: true, output: '\u001b[31mred\u001b[0m line' })).toBe('red line')
  })

  it('is deterministic (byte-stable across calls — KV-cache prefix)', () => {
    const a = renderToolResultContent({ success: false, output: 'x', error: 'y' })
    const b = renderToolResultContent({ success: false, output: 'x', error: 'y' })
    expect(a).toBe(b)
  })

  it('does not truncate output within the limit', () => {
    const output = 'a'.repeat(99_999)
    expect(renderToolResultContent({ success: true, output })).toBe(output)
  })

  it('truncates output exceeding the limit and annotates the total size', () => {
    const output = 'a'.repeat(150_000)
    const result = renderToolResultContent({ success: true, output })
    expect(result.startsWith('a'.repeat(100_000))).toBe(true)
    expect(result).toContain('[Output truncated: 150000 characters total, showing first 100000]')
    expect(result.length).toBe(100_000 + '\n\n[Output truncated: 150000 characters total, showing first 100000]'.length)
  })

  it('truncates deterministically (byte-stable — KV-cache prefix)', () => {
    const output = 'b'.repeat(150_000)
    const a = renderToolResultContent({ success: true, output })
    const b = renderToolResultContent({ success: true, output })
    expect(a).toBe(b)
  })
})
