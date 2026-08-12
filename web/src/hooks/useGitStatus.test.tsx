// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { create } from 'zustand'
import { useGitStatus } from './useGitStatus'
import { SessionScopeProvider } from '../stores/session/session-scope'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { storeHolder } = vi.hoisted(() => ({ storeHolder: [] as unknown[] }))

// Minimal real zustand store so the hook subscribes exactly like production.
vi.mock('../stores/session', () => {
  const store = create(() => ({
    focusedSessionId: null as string | null,
    currentSession: null as { id: string; workdir?: string } | null,
    gitStatus: null as { branch: string | null; diff: unknown } | null,
    panes: {} as Record<string, unknown>,
  }))
  storeHolder.push(store)
  return { useSessionStore: store }
})

interface StoreShape {
  focusedSessionId: string | null
  currentSession: { id: string; workdir?: string } | null
  gitStatus: { branch: string | null; diff: unknown } | null
  panes: Record<string, unknown>
}

type MockStore = StoreShape & {
  setState: (partial: Partial<StoreShape>) => void
}

function makeSplitState(): StoreShape {
  const gitA = { branch: 'feature-a', diff: { files: [{ path: 'a.ts' }] } }
  const gitB = { branch: 'feature-b', diff: { files: [] } }
  return {
    focusedSessionId: 'B',
    currentSession: { id: 'B', workdir: '/repo/b' },
    gitStatus: gitB,
    panes: {
      A: { session: { id: 'A', workdir: '/repo/a' }, gitStatus: gitA },
      B: { session: { id: 'B', workdir: '/repo/b' }, gitStatus: gitB },
    },
  }
}

function scopeWrapper(scopeId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SessionScopeProvider value={scopeId}>{children}</SessionScopeProvider>
  }
}

describe('useGitStatus — split view pane scoping', () => {
  it('reads the scoped pane git status inside a SessionScopeProvider', () => {
    const store = storeHolder[0] as MockStore
    store.setState(makeSplitState())

    const { result } = renderHook(() => useGitStatus(), { wrapper: scopeWrapper('A') })

    expect(result.current.branch).toBe('feature-a')
    expect(result.current.diff.files.map((f) => (f as { path: string }).path)).toEqual(['a.ts'])
  })

  it('reads the focused session git status when unscoped', () => {
    const store = storeHolder[0] as MockStore
    store.setState(makeSplitState())

    const { result } = renderHook(() => useGitStatus())

    expect(result.current.branch).toBe('feature-b')
  })

  it('falls back to the flat git status when the scoped session has no pane', () => {
    const store = storeHolder[0] as MockStore
    store.setState({
      focusedSessionId: 'B',
      currentSession: { id: 'B', workdir: '/repo/b' },
      gitStatus: { branch: 'main', diff: { files: [] } },
      panes: {},
    })

    const { result } = renderHook(() => useGitStatus())

    expect(result.current.branch).toBe('main')
  })
})
