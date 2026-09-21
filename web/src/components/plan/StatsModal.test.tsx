// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StatsModal } from './StatsModal'
import { computeSessionStatsSummary } from '@shared/stats.js'
import { authFetch } from '../../lib/api'
import type { Message, SessionStatsSummary } from '@shared/types.js'

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

vi.mock('../shared/SelfContainedModal', () => ({
  Modal: ({ children, isOpen }: { children: React.ReactNode; isOpen?: boolean }) =>
    isOpen ? <div>{children}</div> : null,
}))

vi.mock('../shared/Sparkline', () => ({
  DualSparkline: () => null,
}))

const authFetchMock = vi.mocked(authFetch)

function message(id: string, totalTime: number, toolTime: number, prefill: number, gen: number): Message {
  return {
    id,
    role: 'assistant',
    content: 'done',
    timestamp: `2024-01-01T10:00:${id.length}Z`,
    stats: {
      providerId: 'p1',
      providerName: 'P',
      backend: 'vllm',
      model: 'm1',
      mode: 'builder',
      totalTime,
      toolTime,
      prefillTokens: prefill,
      prefillSpeed: 10000,
      generationTokens: gen,
      generationSpeed: 150,
    },
  }
}

function summaryFor(count: number): SessionStatsSummary {
  const messages = Array.from({ length: count }, (_, i) => message(`m${i}`, 10, 2, 50000, 500))
  return computeSessionStatsSummary(messages)!
}

beforeEach(() => {
  authFetchMock.mockReset()
})

describe('StatsModal', () => {
  it('renders the summary cards from the lean payload without fetching the full log for large sessions', () => {
    const summary = summaryFor(200)

    render(<StatsModal isOpen onClose={() => {}} summary={summary} sessionId="s1" />)

    expect(screen.getByText('Summary')).toBeTruthy()
    expect(screen.getByText('200')).toBeTruthy()
    expect(screen.getByText(/Load full stats/i)).toBeTruthy()
    expect(authFetchMock).not.toHaveBeenCalled()
  })

  it('loads the full response log on demand and renders it once', async () => {
    const summary = summaryFor(200)
    const fullStats = computeSessionStatsSummary(
      Array.from({ length: 200 }, (_, i) => message(`m${i}`, 10, 2, 50000, 500)),
    )!
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        stats: {
          ...fullStats,
          dataPoints: [],
          callDataPoints: [],
          modelGroups: fullStats.modelGroups.map((g) => ({ ...g, dataPoints: [], callDataPoints: [] })),
        },
      }),
    } as Response)

    const { rerender } = render(<StatsModal isOpen onClose={() => {}} summary={summary} sessionId="s1" />)
    fireEvent.click(screen.getByText(/Load full stats/i))

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledWith('/api/sessions/s1/stats'))

    // Response log renders after the fetch resolves
    await waitFor(() => expect(screen.getByText(/Response Log \(\d+ responses\)/i)).toBeTruthy())

    // Re-open with the same session keeps the cached detail — no second stats fetch.
    rerender(<StatsModal isOpen onClose={() => {}} summary={summary} sessionId="s1" />)
    expect(authFetchMock.mock.calls.filter(([url]) => url === '/api/sessions/s1/stats')).toHaveLength(1)
  })

  it('auto-loads the full log for small sessions without a button', async () => {
    const summary = summaryFor(3)
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        stats: {
          ...summary,
          dataPoints: [],
          callDataPoints: [],
          modelGroups: summary.modelGroups.map((g) => ({ ...g, dataPoints: [], callDataPoints: [] })),
        },
      }),
    } as Response)

    render(<StatsModal isOpen onClose={() => {}} summary={summary} sessionId="s1" />)

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Load full stats/i)).toBeNull()
    await waitFor(() => expect(screen.getByText(/Response Log \(\d+ responses\)/i)).toBeTruthy())
  })

  it('surfaces a load failure without crashing', async () => {
    const summary = summaryFor(200)
    authFetchMock.mockResolvedValue({ ok: false, status: 500 } as Response)

    render(<StatsModal isOpen onClose={() => {}} summary={summary} sessionId="s1" />)
    fireEvent.click(screen.getByText(/Load full stats/i))

    await waitFor(() => expect(screen.getByText(/HTTP 500/i)).toBeTruthy())
  })

  it('discards a stale full-stats response that lands after a session switch', async () => {
    const summary = summaryFor(200)
    let resolveFetch!: (value: Response) => void
    authFetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    const { rerender } = render(<StatsModal isOpen onClose={() => {}} summary={summary} sessionId="s1" />)
    fireEvent.click(screen.getByText(/Load full stats/i))

    // Switch sessions while the fetch is still in flight.
    rerender(<StatsModal isOpen onClose={() => {}} summary={summary} sessionId="s2" />)

    resolveFetch({
      ok: true,
      json: async () => ({
        stats: {
          ...summary,
          dataPoints: [],
          callDataPoints: [],
          modelGroups: summary.modelGroups.map((g) => ({ ...g, dataPoints: [], callDataPoints: [] })),
        },
      }),
    } as Response)

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    // The stale response must not surface the old session's response log.
    expect(screen.queryByText(/Response Log \(\d+ responses\)/i)).toBeNull()
  })
})
