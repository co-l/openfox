// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from './ChatInput'

const { authFetchMock, currentSessionMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(() => Promise.resolve({ ok: true })),
  currentSessionMock: { id: 's1', workdir: '/tmp', projectId: 'p1', messageCount: 0 },
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
    }),
  useIsRunning: () => false,
  useQueuedMessages: () => [],
}))

vi.mock('../../stores/workflows', () => ({
  useWorkflowsStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({ defaults: [], userItems: [], projectItems: [], fetchWorkflows: vi.fn() }),
    { getState: () => ({ defaults: [], userItems: [], projectItems: [], fetchWorkflows: vi.fn() }) },
  ),
  selectAllWorkflows: (state: { defaults: unknown[]; userItems: unknown[]; projectItems: unknown[] }) => [
    ...state.defaults,
    ...state.userItems,
    ...state.projectItems,
  ],
  useAllWorkflows: () => [],
}))

vi.mock('../../stores/commands', () => ({
  useCommandsStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({ defaults: [], userItems: [], projectItems: [], fetchCommands: vi.fn() }),
    { getState: () => ({ defaults: [], userItems: [], projectItems: [], fetchCommands: vi.fn() }) },
  ),
}))

vi.mock('../../hooks/useScrolledSend', () => ({
  useScrolledSend: () => ({ sendMessage: vi.fn(), launchWorkflow: vi.fn() }),
}))

vi.mock('../../stores/settings', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    useSettingsStore: (selector: (state: unknown) => unknown) =>
      selector({ settings: { 'features.perSessionMcp': 'false' } }),
  }
})

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
})
