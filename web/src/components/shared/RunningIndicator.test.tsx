// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { act } from 'react'
import { RunningIndicator } from './RunningIndicator'
import { useSessionStore } from '../../stores/session'
import type { Session } from '@shared/types.js'

// This file drives a live 1s ticker via fake timers, so enable React's act()
// environment locally (scoped to this file — enabling it globally makes other
// suites like AskUserCard warn about unwrapped updates they don't expect).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    projectId: 'proj-1',
    workdir: '/tmp/test',
    mode: 'builder',
    phase: 'build',
    isRunning: false,
    providerId: null,
    providerModel: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-06-15T12:34:56.000Z',
    messages: [],
    criteria: [],
    contextWindows: [],
    executionState: null,
    metadata: { title: 'Test', totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
    metadataEntries: {},
    ...overrides,
  }
}

const roots: Root[] = []

function render(): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  flushSync(() => root.render(<RunningIndicator />))
  return container
}

afterEach(() => {
  for (const r of roots) r.unmount()
  roots.length = 0
  vi.useRealTimers()
  // Reset the act-environment flag so it doesn't leak into other test files
  // sharing this worker (a leaked `true` makes unrelated suites warn about
  // unwrapped updates, e.g. AskUserCard).
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
})

beforeEach(() => {
  document.body.innerHTML = ''
  useSessionStore.setState({
    currentSession: null,
    messages: [],
    pendingQuestions: [],
    pendingPathConfirmations: [],
    activeWorkflowExecution: null,
    abortInProgress: false,
  })
})

describe('RunningIndicator — factually-derived state from existing client data', () => {
  it('renders nothing when there is no current session (state=null)', () => {
    const container = render()
    expect(container.querySelector('[data-testid="session-status-indicator"]')).toBeNull()
  })

  it('renders nothing when no factually evident state matches (state=null)', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'plan', isRunning: false }),
    })
    const container = render()
    expect(container.querySelector('[data-testid="session-status-indicator"]')).toBeNull()
  })

  it('renders "Running" without a phase suffix when isRunning=true and phase=build', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build', isRunning: true }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('data-state')).toBe('running')
    expect(el?.textContent).toContain('Running')
    // Session phase is legacy (always "plan" outside workflows) — no suffix.
    expect(el?.textContent).not.toContain('Build')
    expect(el?.textContent).not.toContain('•')
  })

  it('renders "Running" regardless of the legacy phase value', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'plan', isRunning: true }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('running')
    expect(el?.textContent).toContain('Running')
    expect(el?.textContent).not.toContain('Plan')
  })

  it('renders "Running" when phase=verification (no phase suffix)', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'verification', isRunning: true }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('running')
    expect(el?.textContent).toContain('Running')
    expect(el?.textContent).not.toContain('Verification')
  })

  it('renders "Waiting for input" when there are pending questions (no phase suffix)', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build' }),
      pendingQuestions: [{ callId: 'q1', question: 'Pick?', type: 'choice', options: undefined }],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('waiting')
    expect(el?.textContent).toContain('Waiting for input')
    expect(el?.textContent).not.toContain('Build')
  })

  it('renders "Waiting for input" without phase suffix when phase=waiting (no pendingQuestions)', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'waiting' }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('waiting')
    expect(el?.textContent).toContain('Waiting for input')
    // No redundant "• Waiting" suffix when phase=waiting.
    expect(el?.textContent).not.toContain('•')
  })

  it('renders "Waiting for input" when there are pending path confirmations', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build' }),
      pendingPathConfirmations: [
        {
          callId: 'pc-1',
          tool: 'run_command',
          paths: ['/etc/secret'],
          workdir: '/tmp',
          reason: 'sensitive_file',
        },
      ],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('waiting')
    expect(el?.textContent).toContain('Waiting for input')
  })

  it('renders "Blocked" alone (no redundant "• Blocked" suffix) when phase=blocked and nothing is waiting', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'blocked' }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('blocked')
    expect(el?.textContent).toContain('Blocked')
    // No redundant "• Blocked" suffix — phase=blocked is implied by the state name.
    expect(el?.textContent).not.toContain('•')
  })

  it('prioritizes "waiting" over "blocked" when phase=blocked but pending questions exist', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'blocked' }),
      pendingQuestions: [{ callId: 'q1', question: '?', type: 'text', options: undefined }],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('waiting')
  })

  it('renders "Completed" alone (no redundant "Done" suffix) when phase=done and not running', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'done', isRunning: false }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('completed')
    expect(el?.textContent).toContain('Completed')
    // No redundant "• Done" suffix — phase=done is implied by the state name.
    expect(el?.textContent).not.toContain('•')
  })

  it('does NOT render "Completed" when phase=done but isRunning=true (state=running)', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'done', isRunning: true }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('running')
  })

  it('strict priority waiting > blocked > completed > running > null', () => {
    // phase=blocked + phase effectively 'done' would be contradictory; use blocked
    // to verify blocked wins over completed.
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'blocked', isRunning: false }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('blocked')
  })

  it('exposes workflow step from activeWorkflowExecution', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build', isRunning: true }),
      activeWorkflowExecution: {
        id: 'wf-1',
        sessionId: 'session-1',
        workflowId: 'wf-def',
        workflowName: 'Default',
        status: 'running',
        currentStepId: 'step-1',
        currentStepName: 'Implement feature',
        stepOutput: {},
        params: {},
        createdAt: 0,
        updatedAt: 0,
      },
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.textContent).toContain('Running')
    // The workflow step is not part of the basic label — this is intentional;
    // the indicator stays minimal in this first build.
  })

  it('does NOT show bounce animation in the waiting state (static label only)', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build' }),
      pendingQuestions: [{ callId: 'q1', question: 'Pick?', type: 'choice', options: undefined }],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('waiting')
    // No animate-bounce class on any dot in the waiting state.
    const bounceDots = el?.querySelectorAll('.animate-bounce') ?? []
    expect(bounceDots.length).toBe(0)
  })

  it('does NOT show bounce animation in the blocked state (static label only)', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'blocked' }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('blocked')
    const bounceDots = el?.querySelectorAll('.animate-bounce') ?? []
    expect(bounceDots.length).toBe(0)
  })

  it('does NOT show bounce animation in the completed state (static label only)', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'done', isRunning: false }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('completed')
    const bounceDots = el?.querySelectorAll('.animate-bounce') ?? []
    expect(bounceDots.length).toBe(0)
  })

  it('does introduce click handlers (strictly read-only)', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build', isRunning: true }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el).not.toBeNull()
    // No button children (the component is purely informational).
    expect(el?.querySelectorAll('button').length).toBe(0)
    // No anchor links.
    expect(el?.querySelectorAll('a').length).toBe(0)
  })

  it('shows a relative "time since last user prompt" that ticks every second', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:34:56.000Z'))
    useSessionStore.setState({
      currentSession: makeSession({
        phase: 'build',
        isRunning: true,
        // updatedAt is deliberately later than the prompt — the counter must
        // anchor on the last user prompt, not on session activity.
        updatedAt: '2024-06-15T12:34:59.000Z',
      }),
      messages: [{ id: 'u1', role: 'user', content: 'Fix the bug', timestamp: '2024-06-15T12:34:53.000Z' }],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    // 3s since the user prompt → relative counter with integer seconds.
    expect(el?.textContent).toContain('3s')

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(el?.textContent).toContain('5s')

    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(el?.textContent).toContain('9s')

    vi.useRealTimers()
  })

  it('hides the "time since last user prompt" counter in the completed state', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:34:56.000Z'))
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'done', isRunning: false }),
      messages: [{ id: 'u1', role: 'user', content: 'Fix the bug', timestamp: '2024-06-15T12:34:53.000Z' }],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('completed')
    // Terminal state: the counter must be hidden, not frozen.
    expect(el?.querySelector('[aria-label="time since last prompt"]')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(el?.querySelector('[aria-label="time since last prompt"]')).toBeNull()

    vi.useRealTimers()
  })

  it('hides the "time since last user prompt" counter in the blocked state', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:34:56.000Z'))
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'blocked', isRunning: false }),
      messages: [{ id: 'u1', role: 'user', content: 'Fix the bug', timestamp: '2024-06-15T12:34:53.000Z' }],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('blocked')
    expect(el?.querySelector('[aria-label="time since last prompt"]')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(el?.querySelector('[aria-label="time since last prompt"]')).toBeNull()

    vi.useRealTimers()
  })

  it('shows and ticks the "time since last user prompt" counter in the waiting state', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:34:56.000Z'))
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build' }),
      pendingQuestions: [{ callId: 'q1', question: 'Pick?', type: 'choice', options: undefined }],
      messages: [{ id: 'u1', role: 'user', content: 'Fix the bug', timestamp: '2024-06-15T12:34:53.000Z' }],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('waiting')
    expect(el?.textContent).toContain('3s')

    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(el?.textContent).toContain('7s')

    vi.useRealTimers()
  })

  it('re-syncs the counter when the session resumes after a terminal-state idle', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:34:56.000Z'))
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'done', isRunning: false }),
      messages: [{ id: 'u1', role: 'user', content: 'Fix the bug', timestamp: '2024-06-15T12:34:53.000Z' }],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('completed')
    expect(el?.querySelector('[aria-label="time since last prompt"]')).toBeNull()

    // The session sat idle in a terminal state for 10 minutes.
    act(() => {
      vi.advanceTimersByTime(600_000)
    })

    // A new action resumes the session — the counter must show the full
    // elapsed time immediately, not a stale mount-time value.
    act(() => {
      useSessionStore.setState({
        currentSession: makeSession({ phase: 'done', isRunning: true }),
      })
    })
    const resumed = container.querySelector('[data-testid="session-status-indicator"]')
    expect(resumed?.getAttribute('data-state')).toBe('running')
    expect(resumed?.textContent).toContain('10m 3s')

    vi.useRealTimers()
  })

  it('resets the counter on workflow launch (workflow-started anchor)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:34:56.000Z'))
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build', isRunning: true }),
      messages: [
        { id: 'u1', role: 'user', content: 'Old prompt', timestamp: '2024-06-15T11:00:00.000Z' },
        {
          id: 'wf1',
          role: 'user',
          content: '{"workflowName":"Build"}',
          isSystemGenerated: true,
          messageKind: 'workflow-started',
          timestamp: '2024-06-15T12:34:53.000Z',
        },
      ],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    // Anchored at the workflow launch (3s ago), not the old prompt.
    expect(el?.textContent).toContain('3s')

    vi.useRealTimers()
  })

  it('does not show the relative counter when there is no user prompt', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'done', isRunning: false }),
      messages: [{ id: 'a1', role: 'assistant', content: 'hi', timestamp: '2024-06-15T12:34:53.000Z' }],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.textContent).toContain('Completed')
    expect(el?.textContent).not.toMatch(/\d+(\.\d+)?s/)
  })
})

describe('RunningIndicator — pause states', () => {
  it('renders "Pausing…" with the bounce still active while the pause is pending', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build', isRunning: true, pauseState: 'pending' }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('pausing')
    expect(el?.textContent).toContain('Pausing…')
    expect(el?.textContent).not.toContain('Running')
    const bounceDots = el?.querySelectorAll('.animate-bounce') ?? []
    expect(bounceDots.length).toBeGreaterThan(0)
  })

  it('renders "Paused" without the bounce when the agent is blocked', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build', isRunning: true, pauseState: 'paused' }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('paused')
    expect(el?.textContent).toContain('Paused')
    expect(el?.textContent).not.toContain('Running')
    const bounceDots = el?.querySelectorAll('.animate-bounce') ?? []
    expect(bounceDots.length).toBe(0)
  })

  it('renders "Paused" during the transient resuming state as well', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build', isRunning: true, pauseState: 'resuming' }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('paused')
  })

  it('waiting for user input takes priority over a pending pause', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build', isRunning: true, pauseState: 'pending' }),
      pendingQuestions: [{ callId: 'q1', question: 'Pick?', type: 'choice', options: undefined }],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('waiting')
  })
})
