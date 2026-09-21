// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from './ChatInput'
import { SETTINGS_KEYS } from '../../lib/resources'

const { currentSessionMock, runningRef, sendMessageMock } = vi.hoisted(() => ({
  currentSessionMock: { id: 's1', workdir: '/tmp', projectId: 'p1', messageCount: 0 },
  runningRef: { value: false },
  sendMessageMock: vi.fn(),
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
  useScrolledSend: () => ({ sendMessage: sendMessageMock, launchWorkflow: vi.fn() }),
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
  it('shows the touch send button (same pill size as desktop, icon instead of label) and no stop until running', () => {
    renderChat()
    const send = screen.getByTestId('chat-send-button-touch')
    expect(send).toBeInTheDocument()
    expect(send.className).toContain('rounded-l')
    expect(send.className).toContain('px-4')
    expect(send.className).toContain('py-2')
    expect(send.className).not.toContain('rounded-full')
    expect(screen.queryByTestId('chat-stop-button-touch')).not.toBeInTheDocument()
  })

  it('keeps the touch send button next to the stop button while running so messages can be queued', () => {
    runningRef.value = true
    renderChat()
    const stop = screen.getByTestId('chat-stop-button-touch')
    expect(stop).toBeInTheDocument()
    expect(stop.className).toContain('px-3')
    expect(stop.className).toContain('py-2')
    expect(stop.className).not.toContain('rounded-full')
    const send = screen.getByTestId('chat-send-button-touch')
    expect(send).toBeInTheDocument()
    expect(send.className).toContain('rounded-l')
  })

  it('shows the touch pause button next to the stop button while running', () => {
    runningRef.value = true
    renderChat()
    const pause = screen.getByTestId('chat-pause-button-touch')
    expect(pause).toBeInTheDocument()
    expect(pause.className).toContain('px-3')
    expect(pause.className).toContain('py-2')
    expect(pause.className).not.toContain('rounded-full')
    expect(screen.getByTestId('chat-stop-button-touch')).toBeInTheDocument()
  })

  it('pins the textarea to the visual viewport height when focused with the keyboard open', () => {
    settingOverrides[SETTINGS_KEYS.DISPLAY_MOBILE_FULLSCREEN_COMPOSER] = 'true'
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
    settingOverrides[SETTINGS_KEYS.DISPLAY_MOBILE_FULLSCREEN_COMPOSER] = 'true'
    const { rerender } = renderChat('hello')
    const textarea = screen.getByTestId<HTMLTextAreaElement>('chat-input-textarea')
    fireEvent.focus(textarea)
    viewportState = { offsetTop: 0, height: 800, keyboardVisible: false }
    rerender(<ChatInput {...chatProps('hello')} />)

    expect(textarea.style.height).toBe('60px')
    expect(textarea.style.maxHeight).toBe('200px')
  })

  it('stacks the footer into two balanced rows on mobile: agent/danger on top, MCP/model below', () => {
    settingOverrides['features.perSessionMcp'] = 'true'
    renderChat()

    const group = screen.getByTestId('model-selector-group')
    const footer = group.parentElement as HTMLElement
    expect(footer.className).toContain('flex-col')
    expect(footer.className).toContain('gap-y-1')

    const topRow = footer.children[0] as HTMLElement
    expect(topRow.className).toContain('justify-between')

    const mcpSlot = screen.getByTestId('mcp-selector-slot')
    const providerSlot = screen.getByTestId('provider-selector-slot')
    expect(mcpSlot.parentElement).toBe(group)
    const children = Array.from(group.children)
    expect(children.indexOf(mcpSlot)).toBeLessThan(children.indexOf(providerSlot))
    expect(providerSlot.className).toContain('ms-auto')
  })

  it('right-aligns the provider selector when the MCP feature is disabled', () => {
    renderChat()
    expect(screen.queryByTestId('mcp-selector-slot')).toBeNull()
    const providerSlot = screen.getByTestId('provider-selector-slot')
    expect(providerSlot.parentElement?.className).toContain('ms-auto')
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
    settingOverrides[SETTINGS_KEYS.DISPLAY_MOBILE_FULLSCREEN_COMPOSER] = 'true'
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

  it('keeps the textarea auto-sized by default even with the keyboard open (fullscreen is opt-in)', () => {
    const { rerender } = renderChat('hello')
    const textarea = screen.getByTestId<HTMLTextAreaElement>('chat-input-textarea')
    fireEvent.focus(textarea)
    viewportState = { offsetTop: 0, height: 420, keyboardVisible: true }
    rerender(<ChatInput {...chatProps('hello')} />)

    expect(textarea.style.height).toBe('60px')
    expect(textarea.style.maxHeight).toBe('200px')
  })

  it('does not blur the textarea when the send button is pressed while expanded (single tap sends)', () => {
    settingOverrides[SETTINGS_KEYS.DISPLAY_MOBILE_FULLSCREEN_COMPOSER] = 'true'
    const { rerender } = renderChat('hello')
    const textarea = screen.getByTestId<HTMLTextAreaElement>('chat-input-textarea')
    fireEvent.focus(textarea)
    viewportState = { offsetTop: 0, height: 420, keyboardVisible: true }
    rerender(<ChatInput {...chatProps('hello')} />)
    const expanded = `${420 - 96}px`
    expect(textarea.style.height).toBe(expanded)

    const send = screen.getByTestId('chat-send-button-touch')
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    const preventDefaultSpy = vi.spyOn(mouseDown, 'preventDefault')
    fireEvent(send, mouseDown)
    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(textarea.style.height).toBe(expanded)

    fireEvent.click(send)
    expect(sendMessageMock).toHaveBeenCalledWith('hello', [])
  })

  it('keeps the default mousedown behavior on the send button outside the expanded composer', () => {
    renderChat('hello')
    const send = screen.getByTestId('chat-send-button-touch')
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    const preventDefaultSpy = vi.spyOn(mouseDown, 'preventDefault')
    fireEvent(send, mouseDown)
    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })

  it('does not blur the textarea when the more menu trigger is pressed while expanded', () => {
    settingOverrides[SETTINGS_KEYS.DISPLAY_MOBILE_FULLSCREEN_COMPOSER] = 'true'
    const { rerender } = renderChat('hello')
    const textarea = screen.getByTestId<HTMLTextAreaElement>('chat-input-textarea')
    fireEvent.focus(textarea)
    viewportState = { offsetTop: 0, height: 420, keyboardVisible: true }
    rerender(<ChatInput {...chatProps('hello')} />)
    const expanded = `${420 - 96}px`
    expect(textarea.style.height).toBe(expanded)

    // Both the desktop and mobile rows render a trigger; the mobile one is last.
    const triggers = screen.getAllByTitle('More options')
    const mobileTrigger = triggers[triggers.length - 1] as HTMLElement
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    const preventDefaultSpy = vi.spyOn(mouseDown, 'preventDefault')
    fireEvent(mobileTrigger, mouseDown)

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(textarea.style.height).toBe(expanded)
  })
})
