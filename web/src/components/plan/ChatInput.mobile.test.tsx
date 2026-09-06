// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from './ChatInput'

const { currentSessionMock, runningRef } = vi.hoisted(() => ({
  currentSessionMock: { id: 's1', workdir: '/tmp', projectId: 'p1', messageCount: 0 },
  runningRef: { value: false },
}))

let viewportState = { offsetTop: 0, height: 800, keyboardVisible: false }

vi.mock('../../hooks/useVisualViewport', () => ({
  useVisualViewport: () => viewportState,
}))

vi.mock('../../hooks/useIsTouchDevice', () => ({
  useIsTouchDevice: () => true,
}))

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(() => Promise.resolve({ ok: true })),
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
  useIsRunning: () => runningRef.value,
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

const { settingOverrides } = vi.hoisted(() => ({ settingOverrides: {} as Record<string, string> }))

vi.mock('../../hooks/useSetting', () => ({
  useSetting: (key: string, fallback = '') => ({ value: settingOverrides[key] ?? fallback, loading: false }),
}))

vi.mock('./McpSelector', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react')
  return { McpSelector: () => React.createElement('div', { 'data-testid': 'mcp-selector' }, 'MCP') }
})

const SCROLL_HEIGHT_DESC = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'scrollHeight')

let mockScrollHeight = 0

beforeEach(() => {
  for (const key of Object.keys(settingOverrides)) delete settingOverrides[key]
  mockScrollHeight = 60
  viewportState = { offsetTop: 0, height: 800, keyboardVisible: false }
  runningRef.value = false
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return mockScrollHeight
    },
  })
})

afterEach(() => {
  if (SCROLL_HEIGHT_DESC) {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', SCROLL_HEIGHT_DESC)
  }
  cleanup()
  runningRef.value = false
  vi.clearAllMocks()
})

function chatProps(input: string) {
  return {
    input,
    setInput: vi.fn(),
    attachments: [] as never[],
    setAttachments: vi.fn(),
    dragOver: false,
    setDragOver: vi.fn(),
    errorMessage: null,
    setErrorMessage: vi.fn(),
    scrollToBottom: vi.fn(),
    sessionId: 's1',
    showHistory: false,
    history: [] as never[],
    selectedIndex: 0,
    openHistory: vi.fn(),
    closeHistory: vi.fn(),
    navigateUp: vi.fn(),
    navigateDown: vi.fn(),
    selectCurrent: vi.fn(),
    isAutoScrollActive: true,
    setAutoScroll: vi.fn(),
    onOpenMessageSearch: vi.fn(),
    onOpenCommandsModal: vi.fn(),
    onOpenWorkflowsModal: vi.fn(),
    onSelectWorkflow: vi.fn(),
    onSelectWorkflowWithSubGroup: vi.fn(),
    onSendCommand: vi.fn(),
    clearInput: vi.fn(),
  }
}

function renderChat(input = 'some text') {
  return render(<ChatInput {...chatProps(input)} />)
}

describe('ChatInput mobile composer', () => {
  it('shows the touch send icon button and no stop until running', () => {
    renderChat()
    expect(screen.getByTestId('chat-send-button-touch')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-stop-button-touch')).not.toBeInTheDocument()
  })

  it('replaces the touch send icon with the stop icon while running', () => {
    runningRef.value = true
    renderChat()
    expect(screen.getByTestId('chat-stop-button-touch')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-send-button-touch')).not.toBeInTheDocument()
  })

  it('pins the textarea to the visual viewport height when focused with the keyboard open', () => {
    const { rerender } = renderChat('hello')
    const textarea = screen.getByTestId<HTMLTextAreaElement>('chat-input-textarea')
    expect(textarea.style.maxHeight).toBe('200px')

    fireEvent.focus(textarea)
    viewportState = { offsetTop: 0, height: 420, keyboardVisible: true }
    rerender(<ChatInput {...chatProps('hello')} />)

    expect(textarea.style.height).toBe(`${420 - 96}px`)
    expect(textarea.style.maxHeight).toBe('none')
  })

  it('does not expand while focused without a keyboard', () => {
    const { rerender } = renderChat('hello')
    const textarea = screen.getByTestId<HTMLTextAreaElement>('chat-input-textarea')
    fireEvent.focus(textarea)
    viewportState = { offsetTop: 0, height: 800, keyboardVisible: false }
    rerender(<ChatInput {...chatProps('hello')} />)

    expect(textarea.style.height).toBe('60px')
    expect(textarea.style.maxHeight).toBe('200px')
  })

  it('places the MCP selector before the provider selector, on the first footer row', () => {
    settingOverrides['features.perSessionMcp'] = 'true'
    renderChat()

    const mcpSlot = screen.getByTestId('mcp-selector-slot')
    const providerSlot = screen.getByTestId('provider-selector-slot')
    const footer = mcpSlot.parentElement as HTMLElement
    expect(footer).toBe(providerSlot.parentElement)

    const children = Array.from(footer.children)
    expect(children.indexOf(mcpSlot)).toBeLessThan(children.indexOf(providerSlot))
    expect(footer.className).toContain('flex-wrap')
    expect(footer.className).not.toContain('flex-col')
    expect(mcpSlot.className).toContain('ms-auto')
    expect(providerSlot.className).toContain('basis-full')
  })

  it('right-aligns the provider selector on desktop when the MCP feature is disabled', () => {
    renderChat()
    expect(screen.queryByTestId('mcp-selector-slot')).toBeNull()
    expect(screen.getByTestId('provider-selector-slot').className).toContain('@md:ms-auto')
  })

  it('does not clip the provider dropdown behind a clipping ancestor', () => {
    renderChat()
    const providerSlot = screen.getByTestId('provider-selector-slot')
    for (let el: HTMLElement | null = providerSlot; el; el = el.parentElement) {
      expect(el.className).not.toMatch(/overflow-(hidden|clip|auto|scroll)/)
      expect(el.style.overflow || '').toBe('')
    }
  })

  it('restores auto-grown height when the keyboard closes', () => {
    const { rerender } = renderChat('hello')
    const textarea = screen.getByTestId<HTMLTextAreaElement>('chat-input-textarea')
    fireEvent.focus(textarea)

    viewportState = { offsetTop: 0, height: 420, keyboardVisible: true }
    rerender(<ChatInput {...chatProps('hello')} />)
    expect(textarea.style.height).toBe(`${420 - 96}px`)

    viewportState = { offsetTop: 0, height: 800, keyboardVisible: false }
    act(() => {
      rerender(<ChatInput {...chatProps('hello')} />)
    })
    expect(textarea.style.height).toBe('60px')
    expect(textarea.style.maxHeight).toBe('200px')
  })
})
