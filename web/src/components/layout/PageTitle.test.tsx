// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const state = vi.hoisted(() => ({
  project: { id: 'p1', name: 'Proj' } as { id: string; name: string } | null,
  session: { id: 's1', metadata: { title: 'Sess' } } as { id: string; metadata?: { title?: string } } | null,
  isRunning: false,
}))

vi.mock('../../hooks/useCurrentProject', () => ({
  useCurrentProject: () => state.project,
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (s: { currentSession: unknown }) => unknown) => selector({ currentSession: state.session }),
  useIsRunning: () => state.isRunning,
}))

import { PageTitle } from './PageTitle'

describe('PageTitle', () => {
  let container: HTMLDivElement
  let root: Root
  let writes: string[]
  let current = ''

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('DEV', false)
    writes = []
    current = ''
    Object.defineProperty(document, 'title', {
      configurable: true,
      get: () => current,
      set: (value: string) => {
        current = value
        writes.push(value)
      },
    })
    state.project = { id: 'p1', name: 'Proj' }
    state.session = { id: 's1', metadata: { title: 'Sess' } }
    state.isRunning = false
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete (document as unknown as Record<string, unknown>).title
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('renders the idle title', () => {
    act(() => root.render(<PageTitle />))
    expect(document.title).toBe('Proj - Sess | OpenFox')
  })

  it('marks a running session with a static prefix', () => {
    state.isRunning = true
    act(() => root.render(<PageTitle />))
    expect(document.title).toBe('● Proj - Sess | OpenFox')
  })

  it('does not rewrite the title while a session keeps running', () => {
    state.isRunning = true
    act(() => root.render(<PageTitle />))
    const before = writes.length
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(writes.length - before).toBe(0)
  })

  it('does not rewrite an unchanged title when the session object is replaced', () => {
    state.isRunning = true
    act(() => root.render(<PageTitle />))
    const before = writes.length
    for (let i = 0; i < 20; i++) {
      state.session = { id: 's1', metadata: { title: 'Sess' } }
      act(() => root.render(<PageTitle />))
    }
    expect(writes.length - before).toBe(0)
  })

  it('updates the title on run state transitions', () => {
    state.isRunning = true
    act(() => root.render(<PageTitle />))
    state.isRunning = false
    act(() => root.render(<PageTitle />))
    expect(document.title).toBe('Proj - Sess | OpenFox')
    expect(writes).toEqual(['● Proj - Sess | OpenFox', 'Proj - Sess | OpenFox'])
  })
})
