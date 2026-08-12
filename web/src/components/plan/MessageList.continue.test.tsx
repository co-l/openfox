// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MessageList } from './MessageList'

const mockContinueWorkflow = vi.fn()

// Store mock state in a way that survives vi.mock hoisting
// Using a module-level object that we mutate (not reassign)
const mockState = {
  phase: 'waiting',
  hasWaitingWorkflow: true,
  criteriaPending: false,
  displayItems: [] as Array<Record<string, unknown>>,
  pendingChoices: undefined as Array<{ id: string; label: string; goto: string; nextStepName?: string }> | undefined,
}

function buildSessionState() {
  return {
    currentSession: {
      id: 's1',
      phase: mockState.phase,
      mode: 'planner',
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
          status: 'waiting' as const,
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
  }
}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector(buildSessionState()),
  useIsRunning: () => false,
}))

vi.mock('../../stores/workflows', () => ({
  useWorkflowsStore: Object.assign(
    (selector?: (state: unknown) => unknown) =>
      selector
        ? selector({
            defaults: [{ id: 'default', name: 'Build & Verify', color: '#3b82f6' }],
            userItems: [],
            projectItems: [],
            fetchWorkflows: vi.fn(),
          })
        : { defaults: [], userItems: [], projectItems: [], fetchWorkflows: vi.fn() },
    { getState: vi.fn() },
  ),
  selectAllWorkflows: (state: { defaults: unknown[]; userItems: unknown[]; projectItems: unknown[] }) => [
    ...state.defaults,
    ...state.userItems,
    ...state.projectItems,
  ],
  useAllWorkflows: () => [{ id: 'default', name: 'Build & Verify', color: '#3b82f6' }],
}))

vi.mock('../../stores/settings', () => ({
  useDisplaySettings: () => ({
    showThinking: true,
    showVerboseToolOutput: true,
    showStats: true,
    showAgentDefinitions: true,
    showWorkflowBars: true,
  }),
}))

vi.mock('./ChatFeedItems', () => ({
  ChatFeedItems: () => <div>ChatFeedItems</div>,
}))

function renderMessageList() {
  const mockOsRef = {
    current: {
      osInstance: () => null,
      getElement: () => null,
    },
  }
  return render(
    <MessageList
      displayItems={mockState.displayItems as never}
      scrollContainerRef={mockOsRef}
      highlightedMessageId={null}
      onLaunchWorkflow={vi.fn()}
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
