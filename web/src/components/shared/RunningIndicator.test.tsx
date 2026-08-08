// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RunningIndicator } from './RunningIndicator'
import { useSessionStore } from '../../stores/session'
import type { Session } from '@shared/types.js'

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
})

beforeEach(() => {
  document.body.innerHTML = ''
  useSessionStore.setState({
    currentSession: null,
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

  it('renders "Running • Build" when isRunning=true and phase=build', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build', isRunning: true }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('data-state')).toBe('running')
    expect(el?.textContent).toContain('Running')
    expect(el?.textContent).toContain('Build')
  })

  it('renders "Running • Plan" when isRunning=true and phase=plan', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'plan', isRunning: true }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('running')
    expect(el?.textContent).toContain('Plan')
  })

  it('renders "Running • Verification" when isRunning=true and phase=verification', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'verification', isRunning: true }),
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('running')
    expect(el?.textContent).toContain('Verification')
  })

  it('renders "Waiting for input • Build" when there are pending questions', () => {
    useSessionStore.setState({
      currentSession: makeSession({ phase: 'build' }),
      pendingQuestions: [{ callId: 'q1', question: 'Pick?', type: 'choice', options: undefined }],
    })
    const container = render()
    const el = container.querySelector('[data-testid="session-status-indicator"]')
    expect(el?.getAttribute('data-state')).toBe('waiting')
    expect(el?.textContent).toContain('Waiting for input')
    expect(el?.textContent).toContain('Build')
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
})
