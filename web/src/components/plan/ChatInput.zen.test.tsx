// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from './ChatInput'
import { SETTINGS_KEYS, settingResource } from '../../lib/resources'
import { clearCache } from '../../lib/resourceCache'

const { authFetchMock, currentSessionMock, stopGenerationMock, isRunningMock, putCalls } = vi.hoisted(() => {
  const putCalls: Array<{ url: string; value: string }> = []
  return {
    authFetchMock: vi.fn((url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT') {
        const value = JSON.parse(init.body ?? '{}').value as string
        putCalls.push({ url, value })
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: null }) })
    }),
    currentSessionMock: {
      id: 's1',
      workdir: '/tmp',
      projectId: 'p1',
      messageCount: 0,
      pauseState: 'none' as 'none' | 'pending' | 'paused' | 'resuming',
    },
    stopGenerationMock: vi.fn(),
    isRunningMock: { value: false },
    putCalls,
  }
})

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
      pauseGeneration: vi.fn(),
      resumeGeneration: vi.fn(),
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

describe('ChatInput zen mode toggle', () => {
  beforeEach(() => {
    clearCache()
    putCalls.length = 0
  })

  afterEach(() => {
    cleanup()
    clearCache()
    vi.clearAllMocks()
  })

  it('renders the zen toggle in the composer toolbar', () => {
    renderChatInput()

    const zenButton = screen.getByTestId('chat-zen-toggle')
    expect(zenButton).toBeInTheDocument()
    expect(zenButton.textContent).toBe('Zen')
  })

  it('reflects the persisted zen mode state via aria-pressed', () => {
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_ZEN_MODE)
    renderChatInput()
    expect(screen.getByTestId('chat-zen-toggle')).toHaveAttribute('aria-pressed', 'true')
    cleanup()

    settingResource.write('false', SETTINGS_KEYS.DISPLAY_ZEN_MODE)
    renderChatInput()
    expect(screen.getByTestId('chat-zen-toggle')).toHaveAttribute('aria-pressed', 'false')
  })

  it('persists the toggled value on click', () => {
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_ZEN_MODE)
    renderChatInput()

    fireEvent.click(screen.getByTestId('chat-zen-toggle'))

    expect(putCalls).toEqual([{ url: '/api/settings/display.zenMode', value: 'false' }])
    return waitFor(() => expect(screen.getByTestId('chat-zen-toggle')).toHaveAttribute('aria-pressed', 'false'))
  })

  it('turns zen mode on from the default off state', () => {
    settingResource.write('false', SETTINGS_KEYS.DISPLAY_ZEN_MODE)
    renderChatInput()

    fireEvent.click(screen.getByTestId('chat-zen-toggle'))

    expect(putCalls).toEqual([{ url: '/api/settings/display.zenMode', value: 'true' }])
    return waitFor(() => expect(screen.getByTestId('chat-zen-toggle')).toHaveAttribute('aria-pressed', 'true'))
  })
})
