// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BackgroundProcessView } from './BackgroundProcessView'

function renderWait(payload: Record<string, unknown>) {
  return render(<BackgroundProcessView result={JSON.stringify(payload)} action="wait" />)
}

describe('BackgroundProcessView wait action', () => {
  it('renders the wait outcome instead of an unknown-action warning', () => {
    renderWait({
      processId: 'proc-1',
      status: 'exited',
      reason: 'success',
      terminalReason: 'success',
      exitCode: 0,
      signal: null,
      timedOut: false,
      alreadyFinished: false,
      durationMs: 2_400,
      logCursor: 3,
    })

    expect(screen.queryByText(/Unknown action/)).toBeNull()
    expect(screen.getByText('success')).toBeTruthy()
    expect(screen.getByText('exited')).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
    expect(screen.getByText('2s')).toBeTruthy()
  })

  it('renders a cancelled process as cancelled, with no exit code', () => {
    renderWait({
      processId: 'proc-2',
      status: 'stopped',
      reason: 'cancelled',
      exitCode: null,
      timedOut: false,
      durationMs: 1_000,
      logCursor: 0,
    })

    expect(screen.queryByText(/Unknown action/)).toBeNull()
    expect(screen.getByText('cancelled')).toBeTruthy()
    expect(screen.getByText('stopped')).toBeTruthy()
    expect(screen.queryByText('Exit code')).toBeNull()
  })

  it('flags a wait timeout as still running', () => {
    renderWait({
      processId: 'proc-3',
      status: 'timeout',
      reason: 'timeout',
      exitCode: null,
      timedOut: true,
      durationMs: 120_000,
      logCursor: 7,
    })

    expect(screen.queryByText(/Unknown action/)).toBeNull()
    expect(screen.getByText(/still running/)).toBeTruthy()
  })

  it('falls back to the raw result when the payload carries no outcome', () => {
    render(<BackgroundProcessView result={JSON.stringify({ processId: 'proc-4' })} action="wait" />)

    expect(screen.queryByText(/Unknown action/)).toBeNull()
    expect(screen.getByText(/"processId":"proc-4"/)).toBeTruthy()
  })
})
