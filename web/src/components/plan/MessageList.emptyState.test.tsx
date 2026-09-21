// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MessageList } from './MessageList'

// Minimal harness mirroring MessageList.continue.test.tsx — the empty feed is
// the only scenario that exercises emptyState.
const mockState = {
  displayItems: [] as Array<Record<string, unknown>>,
}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      currentSession: { id: 's1', phase: 'planning', criteria: [], metadata: {}, metadataEntries: {} },
      panes: {},
      focusedSessionId: null,
      messages: [],
      hiddenCount: 0,
      error: null,
      clearError: vi.fn(),
    }),
  useIsRunning: () => false,
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
      emptyState={<div data-testid="feed-empty-state">Next task placeholder</div>}
    />,
  )
}

describe('MessageList empty state', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    mockState.displayItems = []
  })

  it('renders the empty state inside the feed when there are no items', () => {
    renderMessageList()
    const emptyState = screen.getByTestId('feed-empty-state')
    expect(emptyState).toBeTruthy()
    expect(emptyState.closest('[data-testid="chat-scroll-container"]')).not.toBeNull()
  })

  it('hides the empty state once the feed has items', () => {
    mockState.displayItems = [{ type: 'message', message: { id: 'm1', role: 'assistant', content: 'hi' } }]
    renderMessageList()
    expect(screen.queryByTestId('feed-empty-state')).toBeNull()
  })
})
