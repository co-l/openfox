// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

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

vi.mock('../../stores/workflows', () => ({
  useWorkflowsStore: (selector?: (state: unknown) => unknown) =>
    selector ? selector({ fetchWorkflows: vi.fn() }) : { fetchWorkflows: vi.fn() },
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

vi.mock('./MessageSearchModal', () => ({
  default: () => null,
  MessageSearchModal: () => null,
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
