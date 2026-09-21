// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { MessageList } from './MessageList'
import { useLocaleStore } from '../../stores/locale'

const mockContinueWorkflow = vi.fn()

// Store mock state in a way that survives vi.mock hoisting
// Using a module-level object that we mutate (not reassign)
const mockState = {
  phase: 'waiting',
  hasWaitingWorkflow: true,
  execStatus: 'waiting' as 'waiting' | 'blocked',
  isRunning: false,
  criteriaPending: false,
  displayItems: [] as Array<Record<string, unknown>>,
  pendingChoices: undefined as Array<{ id: string; label: string; goto: string; nextStepName?: string }> | undefined,
  llmRetry: null as
    | { status: 'retrying'; attempt: number; retryInMs: number; error: string }
    | { status: 'failed'; error: string }
    | null,
}

function buildSessionState() {
  return {
    currentSession: {
      id: 's1',
      phase: mockState.phase,
      mode: 'planner',
      isRunning: mockState.isRunning,
      criteria: [],
      metadata: {},
      metadataEntries: mockState.criteriaPending
        ? { criteria: [{ id: 'c1', description: 'x', status: 'pending' }] }
        : {},
    },
    panes: {},
    focusedSessionId: null,
    waitingWorkflow: mockState.hasWaitingWorkflow
      ? {
          workflowId: 'pr-review',
          workflowName: 'PR Review',
          stepId: 'user_test',
          stepName: 'Manual Testing',
          stepOutput: {} as Record<string, string>,
          params: { feature: 'login' },
        }
      : null,
    activeWorkflowExecution: mockState.hasWaitingWorkflow
      ? {
          id: 'exec-1',
          sessionId: 's1',
          workflowId: 'pr-review',
          workflowName: 'PR Review',
          status: mockState.execStatus,
          currentStepId: 'user_test',
          currentStepName: 'Manual Testing',
          stepOutput: {} as Record<string, string>,
          params: { feature: 'login' },
          ...(mockState.pendingChoices ? { pendingChoices: mockState.pendingChoices } : {}),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      : null,
    messages: [],
    hiddenCount: 0,
    error: null,
    clearError: vi.fn(),
    continueWorkflow: mockContinueWorkflow,
    exitWorkflow: vi.fn(),
    retryLLMNow: vi.fn(),
    retryLLM: vi.fn(),
    llmRetry: mockState.llmRetry,
  }
}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector(buildSessionState()),
  useIsRunning: () => mockState.isRunning,
}))

vi.mock('../../hooks/useWorkflows', () => ({
  useWorkflows: () => ({
    workflows: [{ id: 'default', name: 'Build & Verify', color: '#3b82f6' }],
    refresh: vi.fn(),
  }),
}))

vi.mock('../../hooks/useSessionWorkdir', () => ({
  useSessionWorkdir: () => '/tmp',
}))

vi.mock('../../hooks/useDisplaySettings', () => ({
  useDisplaySettings: () => ({
    showThinking: true,
    showVerboseToolOutput: true,
    showStats: true,
    showAgentDefinitions: true,
    showWorkflowBars: true,
    maxVisibleItems: 300,
  }),
}))

vi.mock('./ChatFeedItems', () => ({
  ChatFeedItems: ({ paginatedHistory }: { paginatedHistory?: boolean }) => (
    <div data-testid="chat-feed" data-paginated-history={String(paginatedHistory)}>
      ChatFeedItems
    </div>
  ),
}))

vi.mock('../shared/ScrollArea', () => ({
  ScrollArea: ({ children, ref: _ref, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
}))

function renderMessageList(
  options: {
    hiddenCount?: number
    onLoadOlder?: (maxItems: number) => Promise<number>
    viewport?: HTMLDivElement
  } = {},
) {
  const mockOsRef = {
    current: {
      osInstance: () => (options.viewport ? { elements: () => ({ viewport: options.viewport }) } : null),
      getElement: () => null,
    },
  }
  return render(
    <MessageList
      displayItems={mockState.displayItems as never}
      scrollContainerRef={mockOsRef as never}
      highlightedMessageId={null}
      onLaunchWorkflow={vi.fn()}
      hiddenCount={options.hiddenCount}
      onLoadOlder={options.onLoadOlder}
    />,
  )
}

describe('MessageList continue workflow button', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    mockContinueWorkflow.mockClear()
    mockState.phase = 'waiting'
    mockState.hasWaitingWorkflow = true
    mockState.criteriaPending = false
    mockState.displayItems = []
    mockState.pendingChoices = undefined
  })

  it('renders continue button when phase is waiting and waitingWorkflow is set', () => {
    renderMessageList()
    expect(screen.getByRole('button', { name: /continue/i })).toBeDefined()
  })

  it('does not render continue button when waitingWorkflow is null', () => {
    mockState.hasWaitingWorkflow = false
    renderMessageList()
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull()
  })

  it('does not render continue button when phase is not waiting', () => {
    mockState.phase = 'build'
    mockState.hasWaitingWorkflow = false
    renderMessageList()
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull()
  })

  it('calls continueWorkflow on click', () => {
    renderMessageList()
    screen.getByRole('button', { name: /continue/i }).click()
    expect(mockContinueWorkflow).toHaveBeenCalledTimes(1)
  })

  it('renders one button per pendingChoices when choices are present', () => {
    mockState.pendingChoices = [
      { id: 'apply', label: 'apply', goto: 'apply_fixes', nextStepName: 'Apply Fixes' },
      { id: 'skip', label: 'skip', goto: 'start_dev_server', nextStepName: 'Start Dev Server' },
      { id: 'continue', label: 'Continue', goto: 'start_dev_server', nextStepName: 'Start Dev Server' },
    ]
    renderMessageList()
    expect(screen.getByRole('button', { name: 'apply' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'skip' })).toBeDefined()
    // The synthetic continue choice shows the NEXT step it leads to, not the current user step
    expect(screen.getByRole('button', { name: /continue pr review \(start dev server\)/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: /manual testing/i })).toBeNull()
  })

  it('falls back to the current step name when a continue choice has no nextStepName', () => {
    mockState.pendingChoices = [{ id: 'continue', label: 'Continue', goto: 'start_dev_server' }]
    renderMessageList()
    expect(screen.getByRole('button', { name: /continue pr review \(manual testing\)/i })).toBeDefined()
  })

  it('calls continueWorkflow with the choice id when a choice button is clicked', () => {
    mockState.pendingChoices = [
      { id: 'apply', label: 'apply', goto: 'apply_fixes' },
      { id: 'skip', label: 'skip', goto: 'start_dev_server' },
    ]
    renderMessageList()
    screen.getByRole('button', { name: 'apply' }).click()
    expect(mockContinueWorkflow).toHaveBeenCalledTimes(1)
    expect(mockContinueWorkflow).toHaveBeenCalledWith('s1', 'apply')
  })

  it('falls back to a single continue button when pendingChoices is absent', () => {
    mockState.pendingChoices = undefined
    renderMessageList()
    expect(screen.getAllByRole('button', { name: /continue/i })).toHaveLength(1)
  })

  it('hides the workflow launcher while a workflow is waiting at a user step', () => {
    mockState.criteriaPending = true
    mockState.displayItems = [{ type: 'message', message: { role: 'assistant', content: 'ok' } }]
    mockState.pendingChoices = [
      { id: 'Work in current workspace', label: 'Work in current workspace', goto: 'build', nextStepName: 'Implement' },
      {
        id: 'Start a new workspace',
        label: 'Start a new workspace',
        goto: 'setup_workspace',
        nextStepName: 'Setting up workspace',
      },
    ]
    renderMessageList()
    expect(screen.queryByTestId('workflow-run-button')).toBeNull()
  })

  it('shows the workflow launcher when no workflow is running or waiting', () => {
    mockState.criteriaPending = true
    mockState.displayItems = [{ type: 'message', message: { role: 'assistant', content: 'ok' } }]
    mockState.hasWaitingWorkflow = false
    renderMessageList()
    expect(screen.getAllByTestId('workflow-run-button').length).toBeGreaterThan(0)
  })
})

describe('MessageList paginated history', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    useLocaleStore.getState().applyLocale('en')
  })

  beforeEach(() => {
    mockState.phase = 'build'
    mockState.hasWaitingWorkflow = false
    mockState.criteriaPending = false
    mockState.displayItems = [
      { type: 'message', message: { id: 'message-3', role: 'user', content: 'three' } },
      { type: 'message', message: { id: 'message-4', role: 'assistant', content: 'four' } },
    ]
  })

  it('loads an older page from the history control', async () => {
    const onLoadOlder = vi.fn(async () => 2)
    renderMessageList({ hiddenCount: 8, onLoadOlder })

    screen.getByRole('button', { name: 'Load older history (8 remaining)' }).click()

    await waitFor(() => expect(onLoadOlder).toHaveBeenCalledWith(30))
    expect(screen.getByTestId('chat-feed').getAttribute('data-paginated-history')).toBe('true')
  })

  it('translates the history controls when the locale is French', () => {
    useLocaleStore.getState().applyLocale('fr')
    renderMessageList({ hiddenCount: 8, onLoadOlder: vi.fn(async () => 2) })

    expect(screen.getByRole('button', { name: 'Charger l’historique précédent (8 restants)' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Ouvrir l’historique complet dans un nouvel onglet' })).toBeDefined()
  })

  it('does not force virtualization when the full history is already present', () => {
    renderMessageList({ hiddenCount: 0 })

    expect(screen.getByTestId('chat-feed').getAttribute('data-paginated-history')).toBe('false')
  })

  it('loads near the top only while the user is scrolling upward and preserves the viewport', async () => {
    const viewport = document.createElement('div')
    let scrollHeight = 1_000
    let scrollTop = 500
    Object.defineProperty(viewport, 'scrollHeight', { get: () => scrollHeight })
    Object.defineProperty(viewport, 'clientHeight', { get: () => 400 })
    Object.defineProperty(viewport, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
      },
    })
    const onLoadOlder = vi.fn(async () => {
      scrollHeight = 1_400
      return 2
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    renderMessageList({ hiddenCount: 8, onLoadOlder, viewport })

    await act(async () => {
      scrollTop = 100
      viewport.dispatchEvent(new Event('scroll'))
      await Promise.resolve()
    })

    await waitFor(() => expect(onLoadOlder).toHaveBeenCalledWith(30))
    expect(scrollTop).toBe(500)
  })

  it('reveals locally virtualized items before requesting another server page', async () => {
    const viewport = document.createElement('div')
    const placeholder = document.createElement('div')
    placeholder.dataset.placeholder = ''
    viewport.appendChild(placeholder)
    let scrollTop = 500
    Object.defineProperty(viewport, 'scrollHeight', { get: () => 1_000 })
    Object.defineProperty(viewport, 'clientHeight', { get: () => 400 })
    Object.defineProperty(viewport, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
      },
    })
    const onLoadOlder = vi.fn(async () => 2)

    renderMessageList({ hiddenCount: 8, onLoadOlder, viewport })

    await act(async () => {
      scrollTop = 100
      viewport.dispatchEvent(new Event('scroll'))
      await Promise.resolve()
    })

    expect(onLoadOlder).not.toHaveBeenCalled()
  })
})

describe('MessageList blocked workflow step', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    mockState.hasWaitingWorkflow = true
    mockState.execStatus = 'waiting'
    mockState.isRunning = false
    mockState.displayItems = []
    mockState.pendingChoices = undefined
  })

  it('renders the blocked-step message with Retry step when blocked and idle', () => {
    mockState.execStatus = 'blocked'
    mockState.isRunning = false
    renderMessageList()
    expect(screen.getByText(/step stopped before finishing/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /retry step/i })).toBeDefined()
  })

  it('does not render the blocked-step message while the session is running', () => {
    mockState.execStatus = 'blocked'
    mockState.isRunning = true
    renderMessageList()
    expect(screen.queryByText(/step stopped before finishing/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /resuming/i })).toBeNull()
  })
})

describe('MessageList LLM retry error modal', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    mockState.hasWaitingWorkflow = false
    mockState.isRunning = false
    mockState.llmRetry = null
    mockState.displayItems = []
    mockState.pendingChoices = undefined
  })

  it('opens the error modal from the retrying pill info button', () => {
    mockState.isRunning = true
    mockState.llmRetry = { status: 'retrying', attempt: 2, retryInMs: 4000, error: 'HTTP 500: boom' }
    renderMessageList()

    fireEvent.click(screen.getByRole('button', { name: /error details/i }))

    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('HTTP 500: boom')).toBeDefined()
  })

  it('keeps the modal open when a new retry attempt arrives with a new error', () => {
    mockState.isRunning = true
    mockState.llmRetry = { status: 'retrying', attempt: 1, retryInMs: 4000, error: 'boom' }
    const { rerender } = renderMessageList()

    fireEvent.click(screen.getByRole('button', { name: /error details/i }))
    expect(screen.getByText('boom')).toBeDefined()

    mockState.llmRetry = { status: 'retrying', attempt: 2, retryInMs: 8000, error: 'rate limited' }
    rerender(
      <MessageList
        displayItems={mockState.displayItems as never}
        scrollContainerRef={{
          current: { osInstance: () => null, getElement: () => null },
        }}
        highlightedMessageId={null}
        onLaunchWorkflow={vi.fn()}
      />,
    )

    expect(screen.getByText('rate limited')).toBeDefined()
    expect(screen.queryByText('boom')).toBeNull()
  })

  it('closes the modal when the retry state clears', () => {
    mockState.isRunning = true
    mockState.llmRetry = { status: 'retrying', attempt: 1, retryInMs: 4000, error: 'boom' }
    const { rerender } = renderMessageList()

    fireEvent.click(screen.getByRole('button', { name: /error details/i }))
    expect(screen.getByText('boom')).toBeDefined()

    mockState.llmRetry = null
    rerender(
      <MessageList
        displayItems={mockState.displayItems as never}
        scrollContainerRef={{
          current: { osInstance: () => null, getElement: () => null },
        }}
        highlightedMessageId={null}
        onLaunchWorkflow={vi.fn()}
      />,
    )

    expect(screen.queryByText('boom')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the error modal from the failed bubble info button and pretty-prints JSON', () => {
    mockState.isRunning = false
    mockState.llmRetry = { status: 'failed', error: '{"error":"boom"}' }
    renderMessageList()

    fireEvent.click(screen.getByRole('button', { name: /error details/i }))

    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText(/"error": "boom"/)).toBeDefined()
  })
})
