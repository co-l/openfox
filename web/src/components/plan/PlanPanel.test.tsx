// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      currentSession: { id: 's1', criteria: [], metadata: {}, metadataEntries: {} },
      messages: [],
      hiddenCount: 0,
      queuedMessages: [],
      abortInProgress: false,
      restoredInput: null,
      gitStatus: null,
      connectionStatus: 'connected',
    }),
  useIsRunning: () => false,
}))

vi.mock('../../stores/agents', () => ({
  useAgentsStore: (selector?: (state: unknown) => unknown) =>
    selector ? selector({ defaults: [], userItems: [] }) : { defaults: [], userItems: [] },
}))

vi.mock('../../stores/commands', () => ({
  useCommandsStore: (selector?: (state: unknown) => unknown) => (selector ? selector({ items: [] }) : { items: [] }),
}))

const mockFetchWorkflows = vi.fn()
const mockWorkflowsState = { defaults: [], userItems: [], fetchWorkflows: mockFetchWorkflows, getState: vi.fn() }
vi.mock('../../stores/workflows', () => ({
  useWorkflowsStore: Object.assign(
    (selector?: (state: unknown) => unknown) => (selector ? selector(mockWorkflowsState) : mockWorkflowsState),
    { getState: vi.fn(() => mockWorkflowsState) },
  ),
}))

vi.mock('../../stores/settings', () => ({
  useDisplaySettings: () => ({
    showThinking: true,
    showVerboseToolOutput: true,
    showStats: true,
    showAgentDefinitions: true,
    showWorkflowBars: true,
    showSyntaxHighlighting: true,
    maxVisibleItems: 300,
  }),
  DISPLAY_SETTINGS_KEYS: [
    'display.showThinking',
    'display.showVerboseToolOutput',
    'display.showStats',
    'display.showAgentDefinitions',
    'display.showWorkflowBars',
    'display.showSyntaxHighlighting',
    'display.maxVisibleItems',
  ],
  SETTINGS_KEYS: { DISPLAY_MAX_VISIBLE_ITEMS: 'display.maxVisibleItems' },
  useSettingsStore: vi.fn(() => ({ settings: {}, loading: {} })),
}))

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

vi.mock('./ChatFeedItems', () => ({
  ChatFeedItems: () => <div>ChatFeedItems</div>,
}))

vi.mock('./SessionHeader', () => ({
  default: () => <div>SessionHeader</div>,
  SessionHeader: () => <div>SessionHeader</div>,
}))

let capturedMsgSearchOnClose: (() => void) | null = null
let capturedMsgSearchOnNavigate: ((index: number) => void) | null = null

vi.mock('./MessageSearchModal', () => ({
  default: (props: { onClose: () => void; onNavigate: (index: number) => void }) => {
    capturedMsgSearchOnClose = props.onClose
    capturedMsgSearchOnNavigate = props.onNavigate
    return null
  },
  MessageSearchModal: (props: { onClose: () => void; onNavigate: (index: number) => void }) => {
    capturedMsgSearchOnClose = props.onClose
    capturedMsgSearchOnNavigate = props.onNavigate
    return null
  },
}))

const mockFocusChatTextarea = vi.fn()
vi.mock('../../lib/focusChatTextarea', () => ({
  focusChatTextarea: (...args: unknown[]) => mockFocusChatTextarea(...args),
}))

vi.mock('./ChatInput', () => ({
  default: () => <div>ChatInput</div>,
  ChatInput: () => <div>ChatInput</div>,
}))

vi.mock('../layout/SessionLayout', () => ({
  SessionLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../shared/ConnectionStatusBar', () => ({
  ConnectionStatusBar: () => null,
}))

vi.mock('../settings/CommandsModal', () => ({
  CommandsModal: () => null,
}))

vi.mock('../settings/WorkflowsModal', () => ({
  WorkflowsModal: () => null,
}))

vi.mock('../QuickActionModal', () => ({
  QuickActionModal: () => null,
}))

vi.mock('./MessageList', () => ({
  default: ({ hiddenCount }: { hiddenCount: number }) => (
    <div>{hiddenCount > 0 && <div data-testid="hidden-count">{hiddenCount} older items hidden</div>}</div>
  ),
  MessageList: ({ hiddenCount }: { hiddenCount: number }) => (
    <div>{hiddenCount > 0 && <div data-testid="hidden-count">{hiddenCount} older items hidden</div>}</div>
  ),
}))

vi.mock('./groupMessages', () => ({
  groupMessages: (messages: unknown[]) => messages as { id: string; role: string }[],
}))

vi.mock('../../hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({ isAutoScrollActive: true, setAutoScroll: vi.fn() }),
}))

vi.mock('../../hooks/useScrolledSend', () => ({
  useScrolledSend: () => ({ sendMessage: vi.fn(), launchWorkflow: vi.fn() }),
}))

vi.mock('../../hooks/usePromptHistory', () => ({
  usePromptHistory: () => ({
    history: [],
    selectedIndex: -1,
    showHistory: false,
    openHistory: vi.fn(),
    closeHistory: vi.fn(),
    navigateUp: vi.fn(),
    navigateDown: vi.fn(),
    selectCurrent: vi.fn(),
  }),
}))

vi.mock('../../hooks/useKeybindings', () => ({
  useKeybindings: () => ({}),
  useBinding: vi.fn(),
  useAgentSwitchingBindings: vi.fn(),
}))

import { PlanPanel } from './PlanPanel'

describe('PlanPanel — server-side truncation integration', () => {
  it('[AUTOMATED] passes through hiddenCount from server response to MessageList', () => {
    const hiddenCount = 7
    const html = renderToStaticMarkup(
      <PlanPanel
        rawMessages={Array.from({ length: 10 }, (_, i) => ({
          id: `msg-${i + 1}`,
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i + 1}`,
          timestamp: new Date().toISOString(),
        }))}
        hiddenCount={hiddenCount}
      />,
    )
    expect(html).toContain('7 older items hidden')
  })

  it('[AUTOMATED] renders with zero hiddenCount when none is provided', () => {
    const html = renderToStaticMarkup(
      <PlanPanel rawMessages={[{ id: 'msg-1', role: 'user', content: 'Hi', timestamp: new Date().toISOString() }]} />,
    )
    expect(html).not.toContain('older items hidden')
  })
})

describe('PlanPanel — message search navigation', () => {
  beforeEach(() => {
    capturedMsgSearchOnClose = null
    capturedMsgSearchOnNavigate = null
    mockFocusChatTextarea.mockClear()
    document.body.innerHTML = ''
  })

  it('[AUTOMATED] MessageSearchModal onClose calls focusChatTextarea(true) — Criterion 0+4', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<PlanPanel />)
    })

    const searchEvent = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true })
    act(() => {
      window.dispatchEvent(searchEvent)
    })

    expect(capturedMsgSearchOnClose).not.toBeNull()

    capturedMsgSearchOnClose!()
    expect(mockFocusChatTextarea).toHaveBeenCalledTimes(1)
    expect(mockFocusChatTextarea).toHaveBeenCalledWith(true)
  })

  it('[AUTOMATED] handleTimelineNavigate uses scrollIntoView({block:"center",behavior:"smooth"}) without scrollBy — Criterion 1', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<PlanPanel />)
    })

    const scrollContainer = document.createElement('div')
    scrollContainer.setAttribute('data-testid', 'chat-scroll-container')
    const target = document.createElement('div')
    target.setAttribute('data-item-index', '0')
    scrollContainer.appendChild(target)
    document.body.appendChild(scrollContainer)

    const scrollIntoViewMock = vi.fn()
    target.scrollIntoView = scrollIntoViewMock
    const scrollByMock = vi.fn()
    scrollContainer.scrollBy = scrollByMock

    const searchEvent = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true })
    act(() => {
      window.dispatchEvent(searchEvent)
    })

    expect(capturedMsgSearchOnNavigate).not.toBeNull()

    capturedMsgSearchOnNavigate!(0)

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1)
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(scrollByMock).not.toHaveBeenCalled()
  })
})
