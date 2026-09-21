// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ContextPopover } from './ContextPopover'
import { SessionScopeProvider } from '../../stores/session/session-scope'

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}))

let storeState: Record<string, unknown> = {}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector(storeState),
}))

vi.mock('../../lib/ws', () => ({
  wsClient: {
    send: (...args: unknown[]) => {
      sendMock(...args)
      return 'request-1'
    },
  },
}))

vi.mock('./DynamicContextPreviewModal', () => ({
  DynamicContextPreviewModal: ({
    isOpen,
    onApply,
    isRunning,
  }: {
    isOpen: boolean
    onApply: () => void
    isRunning: boolean
  }) => (
    <div>
      {isOpen ? <span>preview-modal</span> : null}
      {isRunning ? <span>running</span> : null}
      <button onClick={onApply}>apply</button>
    </div>
  ),
}))

function makeContextState() {
  return {
    currentTokens: 100,
    maxTokens: 1000,
    compactionCount: 0,
    dangerZone: false,
    canCompact: false,
    dynamicContextChanged: false,
  }
}

function makeBaseState() {
  return {
    focusedSessionId: 's1',
    contextState: null,
    currentSession: null,
    pendingUpdate: null,
    queueUpdate: vi.fn(),
    triggerPendingUpdate: vi.fn(),
    compactContext: vi.fn(),
    panes: {
      s1: {
        session: { id: 's1', projectId: 'p1', metadata: { title: 'S1' }, isRunning: false },
        messages: [],
        hiddenCount: 0,
        currentTodos: [],
        contextState: makeContextState(),
        subAgentContextStates: {},
        pendingPathConfirmations: [],
        pendingQuestions: [],
        visionFallbackByMessage: {},
        queuedMessages: [],
        abortInProgress: false,
        restoredInput: null,
        activeWorkflowExecution: null,
        gitStatus: null,
        error: null,
      },
    },
  }
}

describe('ContextPopover', () => {
  beforeEach(() => {
    storeState = makeBaseState()
    sendMock.mockClear()
  })

  afterEach(() => cleanup())

  it('shows the "Rebase system prompt" action unconditionally (no drift flag needed)', () => {
    render(
      <SessionScopeProvider value="s1">
        <ContextPopover />
      </SessionScopeProvider>,
    )
    expect(screen.getByText('Rebase system prompt')).toBeDefined()
  })

  it('does not show a "changes" indicator when dynamicContextChanged is false', () => {
    render(
      <SessionScopeProvider value="s1">
        <ContextPopover />
      </SessionScopeProvider>,
    )
    expect(screen.queryByLabelText('System prompt changes available')).toBeNull()
  })

  it('shows a "changes" indicator when dynamicContextChanged is true', () => {
    storeState = {
      ...makeBaseState(),
      panes: {
        s1: {
          ...(makeBaseState().panes as Record<string, any>)['s1'],
          contextState: { ...makeContextState(), dynamicContextChanged: true },
        },
      },
    }
    render(
      <SessionScopeProvider value="s1">
        <ContextPopover />
      </SessionScopeProvider>,
    )
    expect(screen.getByLabelText('System prompt changes available')).toBeDefined()
  })

  it('shows a "changes" indicator in the sidebar variant when dynamicContextChanged is true', () => {
    storeState = {
      ...makeBaseState(),
      panes: {
        s1: {
          ...(makeBaseState().panes as Record<string, any>)['s1'],
          contextState: { ...makeContextState(), dynamicContextChanged: true },
        },
      },
    }
    render(
      <SessionScopeProvider value="s1">
        <ContextPopover variant="sidebar" />
      </SessionScopeProvider>,
    )
    fireEvent.click(screen.getByTitle('More options'))
    expect(screen.getByLabelText('System prompt changes available')).toBeDefined()
  })

  it('calls onUpdateSystemPrompt when the action is clicked and a handler is provided', () => {
    const onUpdateSystemPrompt = vi.fn()
    render(
      <SessionScopeProvider value="s1">
        <ContextPopover onUpdateSystemPrompt={onUpdateSystemPrompt} />
      </SessionScopeProvider>,
    )
    fireEvent.click(screen.getByText('Rebase system prompt'))
    expect(onUpdateSystemPrompt).toHaveBeenCalledTimes(1)
  })

  it('opens the preview modal when clicked without a handler', () => {
    render(
      <SessionScopeProvider value="s1">
        <ContextPopover />
      </SessionScopeProvider>,
    )
    fireEvent.click(screen.getByText('Rebase system prompt'))
    expect(screen.getByText('preview-modal')).toBeDefined()
  })

  it('exposes the rebase action in the sidebar variant menu', () => {
    render(
      <SessionScopeProvider value="s1">
        <ContextPopover variant="sidebar" />
      </SessionScopeProvider>,
    )
    fireEvent.click(screen.getByTitle('More options'))
    expect(screen.getByText('Rebase system prompt')).toBeDefined()
  })

  it('does not show the legacy "Update system prompt" label anywhere', () => {
    render(
      <SessionScopeProvider value="s1">
        <ContextPopover />
      </SessionScopeProvider>,
    )
    expect(screen.queryByText('Update system prompt')).toBeNull()
  })
})
