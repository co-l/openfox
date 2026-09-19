// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MessageList } from './MessageList'

const mockState = {
  closingAt: undefined as string | undefined,
  isRunning: false,
}
const mockDeleteSession = vi.fn(async () => true)
const mockCancelEndSession = vi.fn(async () => undefined)

function buildSessionState() {
  return {
    currentSession: {
      id: 's1',
      projectId: 'p1',
      phase: 'build',
      mode: 'planner',
      isRunning: mockState.isRunning,
      criteria: [],
      metadata: {},
      metadataEntries: {},
      ...(mockState.closingAt ? { closingAt: mockState.closingAt } : {}),
    },
    panes: {},
    focusedSessionId: null,
    activeWorkflowExecution: null,
    messages: [],
    hiddenCount: 0,
    error: null,
    clearError: vi.fn(),
    continueWorkflow: vi.fn(),
    exitWorkflow: vi.fn(),
    retryLLMNow: vi.fn(),
    retryLLM: vi.fn(),
    llmRetry: null,
    deleteSession: mockDeleteSession,
    cancelEndSession: mockCancelEndSession,
  }
}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector(buildSessionState()),
  useIsRunning: () => mockState.isRunning,
}))

vi.mock('../../hooks/useWorkflows', () => ({
  useWorkflows: () => ({ workflows: [], refresh: vi.fn() }),
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
  }),
}))

vi.mock('./ChatFeedItems', () => ({
  ChatFeedItems: () => <div>ChatFeedItems</div>,
}))

function renderMessageList() {
  const mockOsRef = { current: { osInstance: () => null, getElement: () => null } }
  return render(
    <MessageList
      displayItems={[] as never}
      scrollContainerRef={mockOsRef}
      highlightedMessageId={null}
      onLaunchWorkflow={vi.fn()}
    />,
  )
}

describe('MessageList closing footer', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    mockDeleteSession.mockClear()
    mockCancelEndSession.mockClear()
    mockState.closingAt = '2026-09-13T00:00:00.000Z'
    mockState.isRunning = false
  })

  it('offers the final delete once the closing routine is done', () => {
    renderMessageList()
    expect(screen.getByText('End-of-session command done')).toBeDefined()
    expect(screen.queryByText('This session is closing.')).toBeNull()
    expect(screen.getByTestId('closing-delete-button')).toBeDefined()
    expect(screen.getByTestId('closing-cancel-button')).toBeDefined()
    expect(screen.getByTestId('closing-cancel-button').className).toContain('green')
  })

  it('hides the footer while the closing routine is still running', () => {
    mockState.isRunning = true
    renderMessageList()
    expect(screen.queryByTestId('closing-delete-button')).toBeNull()
  })

  it('hides the footer for a session that is not closing', () => {
    mockState.closingAt = undefined
    renderMessageList()
    expect(screen.queryByTestId('closing-delete-button')).toBeNull()
  })

  it('calls deleteSession / cancelEndSession', () => {
    renderMessageList()
    screen.getByTestId('closing-delete-button').click()
    expect(mockDeleteSession).toHaveBeenCalledWith('s1')
    screen.getByTestId('closing-cancel-button').click()
    expect(mockCancelEndSession).toHaveBeenCalledWith('s1')
  })
})
