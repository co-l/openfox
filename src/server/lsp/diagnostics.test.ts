import { describe, it, expect } from 'vitest'
import { formatDiagnosticsForLLM } from '../tools/diagnostics.js'
import type { Diagnostic } from '../../shared/types.js'

describe('formatDiagnosticsForLLM', () => {
  const makeDiagnostic = (severity: Diagnostic['severity'], message: string, line: number = 1): Diagnostic => ({
    path: '/test/file.ts',
    range: {
      start: { line, character: 0 },
      end: { line, character: 10 },
    },
    severity,
    message,
    source: 'typescript',
  })

  it('returns empty string for no diagnostics', () => {
    expect(formatDiagnosticsForLLM([])).toBe('')
  })

  it('formats single error', () => {
    const diagnostics = [makeDiagnostic('error', 'Type error')]
    const result = formatDiagnosticsForLLM(diagnostics)

    expect(result).toContain('LSP found 1 error(s)')
    expect(result).toContain('[error]')
    expect(result).toContain('Type error')
    expect(result).toContain('Line 2') // 0-indexed line 1 = display line 2
  })

  it('formats single warning', () => {
    const diagnostics = [makeDiagnostic('warning', 'Unused variable')]
    const result = formatDiagnosticsForLLM(diagnostics)

    expect(result).toContain('1 warning(s)')
    expect(result).toContain('[warning]')
    expect(result).toContain('Unused variable')
  })

  it('formats multiple errors and warnings', () => {
    const diagnostics = [
      makeDiagnostic('error', 'Error 1'),
      makeDiagnostic('error', 'Error 2'),
      makeDiagnostic('warning', 'Warning 1'),
    ]
    const result = formatDiagnosticsForLLM(diagnostics)

    expect(result).toContain('2 error(s)')
    expect(result).toContain('1 warning(s)')
  })

  it('sorts by severity (errors first)', () => {
    const diagnostics = [makeDiagnostic('warning', 'Warning message'), makeDiagnostic('error', 'Error message')]
    const result = formatDiagnosticsForLLM(diagnostics)

    const errorIndex = result.indexOf('[error]')
    const warningIndex = result.indexOf('[warning]')
    expect(errorIndex).toBeLessThan(warningIndex)
  })

  it('limits output to 10 diagnostics', () => {
    const diagnostics = Array.from({ length: 15 }, (_, i) => makeDiagnostic('error', `Error ${i + 1}`, i))
    const result = formatDiagnosticsForLLM(diagnostics)

    // Should show 10 errors and note about remaining
    expect(result).toContain('... and 5 more')
    expect((result.match(/\[error\]/g) ?? []).length).toBe(10)
  })

  it('handles info severity', () => {
    const diagnostics = [makeDiagnostic('info', 'Info message')]
    const result = formatDiagnosticsForLLM(diagnostics)

    expect(result).toContain('[info]')
    expect(result).toContain('Info message')
  })

  it('handles hint severity', () => {
    const diagnostics = [makeDiagnostic('hint', 'Hint message')]
    const result = formatDiagnosticsForLLM(diagnostics)

    expect(result).toContain('[hint]')
    expect(result).toContain('Hint message')
  })

  it('includes correct line numbers (1-indexed for display)', () => {
    const diagnostics = [makeDiagnostic('error', 'Error at line 0', 0), makeDiagnostic('error', 'Error at line 9', 9)]
    const result = formatDiagnosticsForLLM(diagnostics)

    expect(result).toContain('Line 1:') // 0-indexed 0 = line 1
    expect(result).toContain('Line 10:') // 0-indexed 9 = line 10
  })
})
