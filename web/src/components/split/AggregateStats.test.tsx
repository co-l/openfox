// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { AggregateStats, clampTooltipLeft } from './AggregateStats'
import type { Message } from '@shared/types.js'

let storeState: {
  openSessionIds: string[]
  panes: Record<string, { messages: Message[] }>
} = {
  openSessionIds: [],
  panes: {},
}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector(storeState),
}))

function messageWithStats(generationSpeed: number, timestamp = Date.now()): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'test',
    timestamp: new Date(timestamp).toISOString(),
    tokenCount: 100,
    stats: {
      providerId: 'provider-1',
      providerName: 'Local vLLM',
      backend: 'vllm',
      model: 'test-model',
      mode: 'builder',
      totalTime: 5,
      toolTime: 1,
      prefillTokens: 1000,
      prefillSpeed: 100,
      generationTokens: 100,
      generationSpeed,
    },
  }
}

describe('AggregateStats', () => {
  beforeEach(() => {
    storeState = { openSessionIds: [], panes: {} }
  })

  afterEach(() => cleanup())

  it('shows a placeholder when no open pane has stats', () => {
    render(<AggregateStats />)
    expect(screen.getByText('No generation in the last 30 min')).toBeDefined()
    expect(screen.getByTestId('aggregate-stats').querySelector('svg')).toBeNull()
  })

  it('renders a generation chart for a single open pane with stats', () => {
    storeState.openSessionIds = ['s1']
    storeState.panes = { s1: { messages: [messageWithStats(40)] } }
    render(<AggregateStats />)
    expect(screen.getByTestId('aggregate-stats').querySelector('svg')).not.toBeNull()
    expect(screen.getByText('40 tok/s')).toBeDefined()
  })

  it('aggregates generation speeds across open panes', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.panes = {
      s1: { messages: [messageWithStats(30, Date.now() - 60_000)] },
      s2: { messages: [messageWithStats(40, Date.now() - 120_000)] },
    }
    render(<AggregateStats />)
    expect(screen.getByTestId('aggregate-stats').querySelector('svg')).not.toBeNull()
    expect(screen.getByText('70 tok/s')).toBeDefined()
  })

  it('shows a placeholder when stats fall outside the 30-minute window', () => {
    storeState.openSessionIds = ['s1']
    storeState.panes = { s1: { messages: [messageWithStats(40, Date.now() - 40 * 60_000)] } }
    render(<AggregateStats />)
    expect(screen.getByText('No generation in the last 30 min')).toBeDefined()
    expect(screen.getByTestId('aggregate-stats').querySelector('svg')).toBeNull()
  })

  it('shows a per-bucket value tooltip on hover', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.panes = {
      s1: { messages: [messageWithStats(30, Date.now() - 60_000)] },
      s2: { messages: [messageWithStats(40, Date.now() - 120_000)] },
    }
    render(<AggregateStats />)
    const chart = screen.getByTestId('aggregate-chart')
    chart.getBoundingClientRect = () => ({ left: 0, width: 660, top: 0, height: 36 }) as DOMRect
    fireEvent.mouseMove(chart, { clientX: 659 })
    const tooltip = screen.getByTestId('aggregate-tooltip')
    expect(tooltip.textContent).toContain('70 tok/s')
    fireEvent.mouseLeave(chart)
    expect(screen.queryByTestId('aggregate-tooltip')).toBeNull()
  })

  it('formats the tooltip clock in 24-hour format', () => {
    storeState.openSessionIds = ['s1']
    storeState.panes = { s1: { messages: [messageWithStats(40)] } }
    render(<AggregateStats />)
    const chart = screen.getByTestId('aggregate-chart')
    chart.getBoundingClientRect = () => ({ left: 0, width: 330, top: 0, height: 36 }) as DOMRect
    fireEvent.mouseMove(chart, { clientX: 329 })
    expect(screen.getByTestId('aggregate-tooltip').textContent).toMatch(/\b\d{2}:\d{2}\b/)
  })
})

describe('clampTooltipLeft', () => {
  it('keeps a centered tooltip at the left edge inside the chart', () => {
    expect(clampTooltipLeft(0, 212, 530)).toBeGreaterThan(0)
  })

  it('keeps a centered tooltip at the right edge inside the chart', () => {
    expect(clampTooltipLeft(100, 298, 801)).toBeLessThan(100)
  })

  it('caps the tooltip at the chart centre when it is wider than the chart', () => {
    expect(clampTooltipLeft(100, 378, 310)).toBe(50)
  })

  it('leaves interior positions untouched', () => {
    expect(clampTooltipLeft(50, 266, 951)).toBe(50)
  })
})
