// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from './ChatInput'

const {
  authFetchMock,
  currentSessionMock,
  pauseGenerationMock,
  resumeGenerationMock,
  stopGenerationMock,
  isRunningMock,
} = vi.hoisted(() => ({
  authFetchMock: vi.fn(() => Promise.resolve({ ok: true })),
  currentSessionMock: {
    id: 's1',
    workdir: '/tmp',
    projectId: 'p1',
    messageCount: 0,
    pauseState: 'none' as 'none' | 'pending' | 'paused' | 'resuming',
  },
  pauseGenerationMock: vi.fn(),
  resumeGenerationMock: vi.fn(),
  stopGenerationMock: vi.fn(),
  isRunningMock: { value: true },
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
      stopGeneration: stopGenerationMock,
      pauseGeneration: pauseGenerationMock,
      resumeGeneration: resumeGenerationMock,
      cancelQueued: vi.fn(),
      queuedMessages: [],
      restoredInput: null,
      clearRestoredInput: vi.fn(),
    }),
  useIsRunning: () => isRunningMock.value,
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

function setPauseState(state: 'none' | 'pending' | 'paused' | 'resuming') {
  currentSessionMock.pauseState = state
}

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

describe('ChatInput pause/stop buttons', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    currentSessionMock.messageCount = 0
    setPauseState('none')
    isRunningMock.value = true
  })

  it('shows an orange pause button and a red stop button while running (state: none)', () => {
    renderChatInput()

    const pauseBtn = screen.getByTestId('chat-pause-button')
    const stopBtn = screen.getByTestId('chat-stop-button')
    expect(pauseBtn).toBeInTheDocument()
    expect(stopBtn).toBeInTheDocument()
    expect(pauseBtn).not.toBeDisabled()
    expect(pauseBtn).toHaveAttribute('title', 'Pause')
    expect(stopBtn).toHaveAttribute('title', 'Stop')
    expect(pauseBtn.className).toContain('accent-warning')
    expect(stopBtn.className).toContain('accent-error')

    fireEvent.click(pauseBtn)
    expect(pauseGenerationMock).toHaveBeenCalledWith('s1')
    expect(stopGenerationMock).not.toHaveBeenCalled()
  })

  it('while pausing (pending) the button stays pressable and cancels the pause', () => {
    setPauseState('pending')
    renderChatInput()

    const pauseBtn = screen.getByTestId('chat-pause-button')
    expect(pauseBtn).not.toBeDisabled()
    expect(pauseBtn).toHaveAttribute('title', 'Pausing, waiting for the current turn to finish')

    fireEvent.click(pauseBtn)
    expect(resumeGenerationMock).toHaveBeenCalledWith('s1')
    expect(pauseGenerationMock).not.toHaveBeenCalled()
  })

  it('while paused the button resumes the session', () => {
    setPauseState('paused')
    renderChatInput()

    const pauseBtn = screen.getByTestId('chat-pause-button')
    expect(pauseBtn).not.toBeDisabled()
    expect(pauseBtn).toHaveAttribute('title', 'Paused')

    fireEvent.click(pauseBtn)
    expect(resumeGenerationMock).toHaveBeenCalledWith('s1')
  })

  it('keeps the icon the same size as the other buttons (no smaller play icon)', () => {
    for (const state of ['none', 'paused'] as const) {
      setPauseState(state)
      renderChatInput()
      const pauseBtn = screen.getByTestId('chat-pause-button')
      const svg = pauseBtn.querySelector('svg')
      expect(svg?.getAttribute('class')).toContain('w-4')
      expect(svg?.getAttribute('class')).toContain('h-4')
      const stopSvg = screen.getByTestId('chat-stop-button').querySelector('svg')
      expect(stopSvg?.getAttribute('class')).toContain('w-4')
      cleanup()
    }
  })

  it('while resuming the button is disabled', () => {
    setPauseState('resuming')
    renderChatInput()

    const pauseBtn = screen.getByTestId('chat-pause-button')
    expect(pauseBtn).toBeDisabled()
    expect(pauseBtn).toHaveAttribute('title', 'Resuming…')

    fireEvent.click(pauseBtn)
    expect(pauseGenerationMock).not.toHaveBeenCalled()
    expect(resumeGenerationMock).not.toHaveBeenCalled()
  })

  it('the stop button aborts regardless of pause state', () => {
    setPauseState('paused')
    renderChatInput()

    fireEvent.click(screen.getByTestId('chat-stop-button'))
    expect(stopGenerationMock).toHaveBeenCalledWith('s1')
  })

  it('hides both buttons when the session is not running', () => {
    isRunningMock.value = false
    renderChatInput()

    expect(screen.queryByTestId('chat-pause-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-stop-button')).not.toBeInTheDocument()
  })
})
