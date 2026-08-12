// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useQueuedMessages, usePendingQuestions, useVisionFallbackItems } from './hooks'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let storeState: Record<string, unknown> = {}

vi.mock('./store', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector(storeState),
}))

beforeEach(() => {
  storeState = {}
})

function makePane(overrides: Record<string, unknown> = {}) {
  return {
    session: { id: 's1', isRunning: false },
    queuedMessages: [{ id: 'q1', content: 'hi', status: 'queued' }],
    pendingQuestions: [{ callId: 'c1', question: 'ok?', type: 'confirm', options: undefined }],
    visionFallbackByMessage: { 'm1-a1': { type: 'start', attachmentId: 'a1' } },
    ...overrides,
  }
}

describe('scoped hooks — stable selector snapshots (no getSnapshot thrash)', () => {
  it('useQueuedMessages keeps a stable reference while the scoped pane is not yet materialized', () => {
    // Reproduces adding a split pane: the sessionId is already handed to
    // ChatInput but panes[sessionId] does not exist yet (and it is not the
    // focused session either).
    storeState = { panes: {}, currentSession: null, queuedMessages: [] }

    const { result, rerender } = renderHook(() => useQueuedMessages('s2'))

    const first = result.current
    rerender()

    expect(result.current).toBe(first)
  })

  it('useQueuedMessages keeps a stable reference when the pane is materialized', () => {
    storeState = { panes: { s1: makePane() }, currentSession: null, queuedMessages: [] }

    const { result, rerender } = renderHook(() => useQueuedMessages('s1'))

    const first = result.current
    rerender()

    expect(result.current).toBe(first)
  })

  it('usePendingQuestions keeps a stable reference while the scoped pane is not yet materialized', () => {
    storeState = { panes: {}, currentSession: null, pendingQuestions: [] }

    const { result, rerender } = renderHook(() => usePendingQuestions('s2'))

    const first = result.current
    rerender()

    expect(result.current).toBe(first)
  })

  it('useVisionFallbackItems keeps a stable reference while the scoped pane is not yet materialized', () => {
    storeState = { panes: {}, currentSession: null, visionFallbackByMessage: {} }

    const { result, rerender } = renderHook(() => useVisionFallbackItems('s2'))

    const first = result.current
    rerender()

    expect(result.current).toBe(first)
  })

  it('useQueuedMessages keeps a stable reference in the flat (unscoped) fallback', () => {
    storeState = { panes: {}, currentSession: { id: 's1' }, queuedMessages: [] }

    const { result, rerender } = renderHook(() => useQueuedMessages())

    const first = result.current
    rerender()

    expect(result.current).toBe(first)
  })
})
