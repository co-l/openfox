// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { WorkflowBar } from './WorkflowBar'
import { useSessionStore } from '../../stores/session'
import { emptyPane } from '../../stores/session/panes'
import { SessionScopeProvider } from '../../stores/session/session-scope'
import { clearCache } from '../../lib/resourceCache'
import type { WorkflowExecution } from '@shared/types.js'

const { workflowResourceMock, agentsResourceMock } = vi.hoisted(() => ({
  workflowResourceMock: {
    keyOf: vi.fn((id: string, workdir?: string, scope?: string) => `workflow:${id}:${workdir ?? ''}:${scope ?? ''}`),
    fetch: vi.fn(async () => null),
    refresh: vi.fn(async () => null),
    invalidate: vi.fn(),
    write: vi.fn(),
    maxAgeMs: 0,
  },
  agentsResourceMock: {
    keyOf: vi.fn((workdir?: string) => `agents:${workdir ?? ''}`),
    fetch: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    invalidate: vi.fn(),
    write: vi.fn(),
    maxAgeMs: 0,
  },
}))

vi.mock('../../lib/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/resources')>()
  return {
    ...actual,
    workflowResource: workflowResourceMock,
    agentsResource: agentsResourceMock,
  }
})

function makeExecution(overrides: Partial<WorkflowExecution> = {}): WorkflowExecution {
  return {
    id: 'exec-1',
    sessionId: 'session-1',
    workflowId: 'wf-1',
    workflowName: 'Build & Verify',
    status: 'running',
    stepOutput: {},
    params: {},
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function setExecution(execution: WorkflowExecution | null): void {
  useSessionStore.setState({
    focusedSessionId: 'session-1',
    activeWorkflowExecution: execution,
    currentSession: { id: 'session-1', workdir: '/tmp/wf' } as never,
  })
}

function renderBar(): HTMLElement {
  return render(
    <SessionScopeProvider value="session-1">
      <WorkflowBar />
    </SessionScopeProvider>,
  ).container
}

describe('WorkflowBar — hover popover', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearCache()
    workflowResourceMock.fetch.mockReset()
    workflowResourceMock.fetch.mockResolvedValue(null)
    setExecution(makeExecution())
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    clearCache()
    useSessionStore.setState({ activeWorkflowExecution: null, currentSession: null })
  })

  it('renders nothing when no workflow execution is active', () => {
    setExecution(null)
    const container = renderBar()
    expect(container.textContent).toBe('')
  })

  it('opens the popover on hover after the delay, without any click', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })

    fireEvent.mouseEnter(anchor)
    // Not open yet — the delay gives the pointer time to reach the popover.
    expect(screen.queryByTestId('workflow-popover')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByTestId('workflow-popover')).toBeTruthy()
  })

  it('does not open when the pointer leaves before the delay elapses', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })

    fireEvent.mouseEnter(anchor)
    fireEvent.mouseLeave(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.queryByTestId('workflow-popover')).toBeNull()
  })

  it('keeps the popover open while the pointer travels from the anchor to the popover', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })

    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const popover = screen.getByTestId('workflow-popover')

    // The pointer leaves the anchor and enters the popover: the close delay
    // must not fire in between.
    fireEvent.mouseLeave(anchor)
    fireEvent.mouseEnter(popover)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.queryByTestId('workflow-popover')).toBeTruthy()
  })

  it('closes the popover after the close delay when the pointer leaves it', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })

    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const popover = screen.getByTestId('workflow-popover')

    fireEvent.mouseLeave(popover)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.queryByTestId('workflow-popover')).toBeNull()
  })

  it('pins the popover: it survives the pointer leaving the anchor', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })

    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const pinButton = screen.getByRole('button', { name: /Pin the workflow graph/i })
    fireEvent.click(pinButton)
    expect(pinButton.getAttribute('aria-pressed')).toBe('true')

    fireEvent.mouseLeave(anchor)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.queryByTestId('workflow-popover')).toBeTruthy()
  })

  it('unpins and closes the popover on Escape', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })

    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    fireEvent.click(screen.getByRole('button', { name: /Pin the workflow graph/i }))
    expect(screen.queryByTestId('workflow-popover')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('workflow-popover')).toBeNull()
  })

  it('does not block the global Escape shortcut while the popover is open', () => {
    // The global Escape shortcut (stop generation) listens on window. The
    // popover must close without swallowing that event.
    const globalEscape = vi.fn()
    window.addEventListener('keydown', globalEscape)

    try {
      renderBar()
      const anchor = screen.getByRole('button', { name: /Build & Verify/i })
      fireEvent.mouseEnter(anchor)
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(screen.queryByTestId('workflow-popover')).toBeTruthy()

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      act(() => {
        document.dispatchEvent(event)
      })

      // The popover closed…
      expect(screen.queryByTestId('workflow-popover')).toBeNull()
      // …and the global handler still saw the keydown.
      expect(globalEscape).toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    } finally {
      window.removeEventListener('keydown', globalEscape)
    }
  })

  it('exposes the popover as a dialog with an accessible name', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })
    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBeTruthy()
  })

  it('stays open when the pointer travels back from the popover to the anchor', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })

    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const popover = screen.getByTestId('workflow-popover')

    // Popover → anchor travel: the pending close must be cancelled, otherwise
    // the popover closes while the pointer is still over the trigger.
    fireEvent.mouseLeave(popover)
    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.queryByTestId('workflow-popover')).toBeTruthy()
  })

  it('keeps the popover mounted when the focus moves from the anchor to the pin button', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })

    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const pinButton = screen.getByRole('button', { name: /Pin the workflow graph/i })

    // Focus moves to the pin button (Tab): the popover must survive so the
    // button stays reachable.
    fireEvent.blur(anchor, { relatedTarget: pinButton })
    expect(screen.queryByTestId('workflow-popover')).toBeTruthy()

    // The pin button is still operable.
    fireEvent.click(pinButton)
    expect(pinButton.getAttribute('aria-pressed')).toBe('true')
  })

  it('closes the popover when the focus leaves both the anchor and the popover', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })

    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const outside = document.createElement('button')
    document.body.appendChild(outside)

    fireEvent.blur(anchor, { relatedTarget: outside })
    expect(screen.queryByTestId('workflow-popover')).toBeNull()
    outside.remove()
  })

  it('opens the popover upward so it is not clipped by the bottom of the chat column', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })
    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })

    const popover = screen.getByTestId('workflow-popover')
    expect(popover.className).toContain('bottom-full')
    expect(popover.className).not.toContain('top-full')
  })

  it('opens and closes the graph on click, so it is reachable without a pointer', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })

    fireEvent.click(anchor)
    expect(screen.getByTestId('workflow-popover')).toBeTruthy()

    fireEvent.click(anchor)
    expect(screen.queryByTestId('workflow-popover')).toBeNull()
  })

  it('keeps the workflow name truncatable instead of forcing the bar to overflow', () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })
    const wrapper = anchor.parentElement

    // The wrapper must be allowed to shrink, otherwise the inner `truncate`
    // can never ellipsize and a long name pushes the step and counter out.
    expect(wrapper?.className).toContain('min-w-0')
    expect(wrapper?.className).not.toContain('shrink-0')
    expect(anchor.className).toContain('max-w-')
    expect(anchor.querySelector('.truncate')).toBeTruthy()
  })

  it('shows an unavailable state when the definition cannot be loaded', async () => {
    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })
    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })

    // The fetch resolved to null (deleted workflow, or a scope that no longer
    // matches): an endless spinner would hide that fact.
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByTestId('workflow-popover-loading')).toBeNull()
    expect(screen.getByTestId('workflow-popover-unavailable')).toBeTruthy()
  })

  it('labels the counter with the cumulative total after a resume', () => {
    setExecution(makeExecution({ currentStepId: 'build', iterations: 1, totalIterations: 12, maxIterations: 50 }))
    renderBar()

    const counter = screen.getByTestId('workflow-iterations')
    // The per-invocation counter is not the run total: a resumed run must not
    // look like it restarted its budget.
    expect(counter.textContent).toContain('1/50')
    expect(counter.textContent).toContain('12')
  })

  it('uses the singular form for a single iteration', () => {
    setExecution(makeExecution({ currentStepId: 'build', iterations: 1 }))
    renderBar()

    const text = screen.getByTestId('workflow-iterations').textContent ?? ''
    expect(text).toContain('1 iteration')
    expect(text).not.toContain('iterations')
  })

  it('shows the exact engine iteration counter and its cap', () => {
    setExecution(
      makeExecution({
        currentStepId: 'build',
        currentStepName: 'Builder',
        iterations: 3,
        totalIterations: 5,
        maxIterations: 50,
      }),
    )
    renderBar()
    const counter = screen.getByTestId('workflow-iterations')
    expect(counter.textContent).toContain('3')
    expect(counter.textContent).toContain('50')
  })

  it('does not show an iteration counter when the server sent none', () => {
    setExecution(makeExecution({ currentStepId: 'build' }))
    renderBar()
    expect(screen.queryByTestId('workflow-iterations')).toBeNull()
  })

  it('loads the definition from the scope of the running execution', () => {
    setExecution(makeExecution({ workflowId: 'shared-id', workflowScope: 'project' }))
    renderBar()

    const anchor = screen.getByRole('button', { name: /Build & Verify/i })
    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })

    // The scope of the running execution is used, so a shadowed id resolves to
    // the definition that is really running.
    expect(workflowResourceMock.keyOf).toHaveBeenCalledWith('shared-id', '/tmp/wf', 'project')
  })

  it('loads the definition without a scope when the execution does not carry one', () => {
    setExecution(makeExecution({ workflowId: 'shared-id' }))
    renderBar()

    const anchor = screen.getByRole('button', { name: /Build & Verify/i })
    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(workflowResourceMock.keyOf).toHaveBeenCalledWith('shared-id', '/tmp/wf', undefined)
  })

  it('keeps two sessions isolated: each pane shows its own execution counters', () => {
    useSessionStore.setState({
      focusedSessionId: 'session-a',
      panes: {
        'session-a': {
          ...emptyPane(),
          session: { id: 'session-a', workdir: '/tmp/a' } as never,
          activeWorkflowExecution: makeExecution({
            id: 'exec-a',
            sessionId: 'session-a',
            workflowName: 'Workflow A',
            iterations: 2,
            maxIterations: 10,
          }),
        },
        'session-b': {
          ...emptyPane(),
          session: { id: 'session-b', workdir: '/tmp/b' } as never,
          activeWorkflowExecution: makeExecution({
            id: 'exec-b',
            sessionId: 'session-b',
            workflowName: 'Workflow B',
            iterations: 7,
            maxIterations: 10,
          }),
        },
      },
    })

    const { unmount } = render(
      <SessionScopeProvider value="session-a">
        <WorkflowBar />
      </SessionScopeProvider>,
    )
    expect(screen.getByTestId('workflow-iterations').textContent).toContain('2')
    expect(screen.getByRole('button', { name: /Workflow A/i })).toBeTruthy()
    unmount()

    render(
      <SessionScopeProvider value="session-b">
        <WorkflowBar />
      </SessionScopeProvider>,
    )
    expect(screen.getByTestId('workflow-iterations').textContent).toContain('7')
    expect(screen.getByRole('button', { name: /Workflow B/i })).toBeTruthy()
  })
})

describe('WorkflowBar — graph labels', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearCache()
    workflowResourceMock.fetch.mockReset()
    agentsResourceMock.fetch.mockReset()
    setExecution(makeExecution())
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    clearCache()
    useSessionStore.setState({ activeWorkflowExecution: null, currentSession: null })
  })

  it('labels agent steps with the agent display name, not the raw id', async () => {
    workflowResourceMock.fetch.mockResolvedValue({
      metadata: { id: 'wf-1', name: 'Build & Verify', description: '', version: '1' },
      entryStep: 'build',
      settings: { maxIterations: 50 },
      steps: [{ id: 'build', name: 'Build', type: 'agent', agentId: 'builder', phase: 'build', transitions: [] }],
    } as never)
    agentsResourceMock.fetch.mockResolvedValue({
      defaults: [
        { id: 'builder', name: 'Builder Agent', description: '', subagent: false, allowedTools: [], color: '#ff0000' },
      ],
      userItems: [],
      projectItems: [],
      modelOverrides: {},
    } as never)

    renderBar()
    const anchor = screen.getByRole('button', { name: /Build & Verify/i })
    fireEvent.mouseEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    await act(async () => {
      await Promise.resolve()
    })

    const graph = screen.getByTestId('workflow-popover-graph')
    expect(graph.textContent).toContain('Builder Agent')
  })
})
