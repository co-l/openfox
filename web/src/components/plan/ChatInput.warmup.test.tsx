// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from './ChatInput'

const { authFetchMock, currentSessionMock, cancelAutoLaunchMock, cancelAutoAnswersMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(() => Promise.resolve({ ok: true })),
  currentSessionMock: { id: 's1', workdir: '/tmp', projectId: 'p1', messageCount: 0 },
  cancelAutoLaunchMock: vi.fn(),
  cancelAutoAnswersMock: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  authFetch: authFetchMock,
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      currentSession: currentSessionMock,
      panes: {},
      focusedSessionId: null,
      stopGeneration: vi.fn(),
      cancelQueued: vi.fn(),
      queuedMessages: [],
      restoredInput: null,
      clearRestoredInput: vi.fn(),
      cancelAutoLaunch: cancelAutoLaunchMock,
      cancelAutoAnswers: cancelAutoAnswersMock,
    }),
  useIsRunning: () => false,
  useQueuedMessages: () => [],
}))

vi.mock('../../hooks/useScrolledSend', () => ({
  useScrolledSend: () => ({ sendMessage: vi.fn(), launchWorkflow: vi.fn() }),
}))

vi.mock('../../hooks/useEffortGateContext', () => ({
  useEffortGateContext: () => ({
    sessionId: 's1',
    currentEffort: undefined,
    warmCache: false,
    gate: { requestEffortSwitch: vi.fn() },
  }),
  useEffortGatedAgentSwitch: () => vi.fn(),
}))

vi.mock('../../components/plan/EffortChangeGate', () => ({
  EffortChangeGateProvider: (props: { children?: unknown }) => <>{props.children}</>,
  useEffortChangeGate: () => ({ requestEffortSwitch: vi.fn() }),
}))
vi.mock('../../hooks/useSetting', () => ({
  useSetting: (_key: string, fallback = '') => ({ value: fallback, loading: false }),
}))

function renderChatInput() {
  return render(
    <ChatInput
      input=""
      setInput={vi.fn()}
      attachments={[]}
      setAttachments={vi.fn()}
      dragOver={false}
      setDragOver={vi.fn()}
      errorMessage={null}
      setErrorMessage={vi.fn()}
      scrollToBottom={vi.fn()}
      sessionId="s1"
      showHistory={false}
      history={[]}
      selectedIndex={0}
      openHistory={vi.fn()}
      closeHistory={vi.fn()}
      navigateUp={vi.fn()}
      navigateDown={vi.fn()}
      selectCurrent={vi.fn()}
      isAutoScrollActive={true}
      setAutoScroll={vi.fn()}
      onOpenMessageSearch={vi.fn()}
      onOpenCommandsModal={vi.fn()}
      onOpenWorkflowsModal={vi.fn()}
      onSelectWorkflow={vi.fn()}
      onSelectWorkflowWithSubGroup={vi.fn()}
      onSendCommand={vi.fn()}
      clearInput={vi.fn()}
    />,
  )
}

describe('ChatInput warmup', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    currentSessionMock.messageCount = 0
  })

  it('triggers warmup on first keystroke in an empty session', () => {
    currentSessionMock.messageCount = 0
    renderChatInput()

    const textarea = screen.getByTestId('chat-input-textarea')
    fireEvent.change(textarea, { target: { value: 'hello' } })

    expect(authFetchMock).toHaveBeenCalledWith('/api/sessions/s1/warmup', { method: 'POST' })
  })

  it('does not trigger warmup when the session has messages', () => {
    currentSessionMock.messageCount = 5
    renderChatInput()

    const textarea = screen.getByTestId('chat-input-textarea')
    fireEvent.change(textarea, { target: { value: 'hello' } })

    expect(authFetchMock).not.toHaveBeenCalledWith('/api/sessions/s1/warmup', { method: 'POST' })
  })

  it('cancels a pending auto-launch countdown on first keystroke', () => {
    currentSessionMock.messageCount = 5
    renderChatInput()

    const textarea = screen.getByTestId('chat-input-textarea')
    fireEvent.change(textarea, { target: { value: 'h' } })

    expect(cancelAutoLaunchMock).toHaveBeenCalledWith('s1')
  })
})
