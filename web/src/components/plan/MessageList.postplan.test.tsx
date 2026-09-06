// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MessageList } from './MessageList'

const mockState = {
  phase: 'done',
  isRunning: false,
  lastWorkflow: null as { workflowId: string; status: string } | null,
  linkedTaskStatus: 'todo' as string | null,
}

function buildSessionState() {
  return {
    currentSession: {
      id: 's1',
      projectId: 'p1',
      phase: mockState.phase,
      mode: 'planner',
      isRunning: mockState.isRunning,
      criteria: [],
      metadata: {},
      metadataEntries: { criteria: [{ id: 'c1', description: 'x', status: 'pending' }] },
    },
    panes: {},
    focusedSessionId: null,
    activeWorkflowExecution: null,
    lastWorkflow: mockState.lastWorkflow,
    messages: [],
    hiddenCount: 0,
    error: null,
    clearError: vi.fn(),
    continueWorkflow: vi.fn(),
    exitWorkflow: vi.fn(),
    retryLLMNow: vi.fn(),
    retryLLM: vi.fn(),
    llmRetry: null,
    autoLaunch: null,
  }
}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector(buildSessionState()),
  useIsRunning: () => mockState.isRunning,
}))

vi.mock('../../hooks/useWorkflows', () => ({
  useWorkflows: () => ({ workflows: [{ id: 'default', name: 'Build & Verify', color: '#3b82f6' }], refresh: vi.fn() }),
}))

vi.mock('../../hooks/useSessionWorkdir', () => ({ useSessionWorkdir: () => '/tmp' }))

vi.mock('../../hooks/useDisplaySettings', () => ({
  useDisplaySettings: () => ({
    showThinking: true,
    showVerboseToolOutput: true,
    showStats: true,
    showAgentDefinitions: true,
    showWorkflowBars: true,
  }),
}))

vi.mock('./ChatFeedItems', () => ({ ChatFeedItems: () => <div>ChatFeedItems</div> }))

vi.mock('./PostPlanLaunchBar', () => ({
  PostPlanLaunchBar: () => <div data-testid="post-plan-launch-bar" />,
}))

vi.mock('../../hooks/useResource', () => ({
  useResourceWhen: (enabled: boolean) =>
    enabled && mockState.linkedTaskStatus
      ? {
          data: {
            id: 't1',
            projectId: 'p1',
            prompt: 'x',
            attachments: [],
            status: mockState.linkedTaskStatus,
            position: 0,
            version: 1,
            sessionIds: ['s1'],
            gateValues: [],
            auditTrail: [],
            createdAt: '',
            updatedAt: '',
          },
        }
      : { data: null },
}))

const assistantItems = [{ type: 'message', message: { role: 'assistant', content: 'Plan done' } }] as never[]

function renderList() {
  return render(
    <MessageList
      displayItems={assistantItems}
      scrollContainerRef={{ current: null }}
      highlightedMessageId={null}
      onLaunchWorkflow={vi.fn()}
    />,
  )
}

describe('MessageList post-plan bar on a settled planner', () => {
  beforeEach(() => {
    mockState.phase = 'done'
    mockState.isRunning = false
    mockState.lastWorkflow = null
    mockState.linkedTaskStatus = 'todo'
  })

  afterEach(cleanup)

  it('renders the post-plan bar when phase done but last run was a completed plan', () => {
    mockState.lastWorkflow = { workflowId: 'plan', status: 'completed' }
    renderList()
    expect(screen.getByTestId('post-plan-launch-bar')).toBeTruthy()
  })

  it('does NOT render the bar when phase done after some other workflow (build)', () => {
    mockState.lastWorkflow = { workflowId: 'default', status: 'completed' }
    renderList()
    expect(screen.queryByTestId('post-plan-launch-bar')).toBeNull()
  })

  it('renders the bar while the task is parked in In Progress (reopen after switch)', () => {
    mockState.lastWorkflow = { workflowId: 'plan', status: 'completed' }
    mockState.linkedTaskStatus = 'in_progress'
    renderList()
    expect(screen.getByTestId('post-plan-launch-bar')).toBeTruthy()
  })
})
