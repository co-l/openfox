// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import { create } from 'zustand'
import { SessionScopeProvider, useSessionScope } from './session-scope'

const { storeHolder } = vi.hoisted(() => ({ storeHolder: [] as unknown[] }))

// Real hook-based store so useSessionStore actually registers hooks (a plain
// selector-calling stub would mask the conditional-hook bug in useSessionScope).
vi.mock('../session', () => {
  const store = create(() => ({
    focusedSessionId: null as string | null,
    currentSession: null,
  }))
  storeHolder.push(store)
  return { useSessionStore: store }
})

// Mirrors SessionHeader: useSessionScope is followed by stateful hooks, so a
// conditional hook inside useSessionScope shifts the queue and crashes.
function Probe() {
  const sessionId = useSessionScope()
  const [count] = useState(0)
  return (
    <span data-testid="scope">
      {sessionId ?? 'none'}-{count}
    </span>
  )
}

describe('useSessionScope', () => {
  it('keeps a stable hook count when the provider value appears after mount', () => {
    const store = storeHolder[0] as {
      setState: (partial: Partial<{ focusedSessionId: string | null; currentSession: null }>) => void
    }
    store.setState({ focusedSessionId: 's1' })

    const { rerender } = render(
      <SessionScopeProvider value="">
        <Probe />
      </SessionScopeProvider>,
    )
    // Falsy scope falls back to the focused session from the store.
    expect(screen.getByTestId('scope').textContent).toBe('s1-0')

    // The scope id popping in (fresh project / new session) must not change
    // how many hooks useSessionScope runs, or React throws.
    rerender(
      <SessionScopeProvider value="s1">
        <Probe />
      </SessionScopeProvider>,
    )
    expect(screen.getByTestId('scope').textContent).toBe('s1-0')
  })
})
