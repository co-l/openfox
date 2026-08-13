// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

const { confirmPathMock, switchDangerLevelMock } = vi.hoisted(() => ({
  confirmPathMock: vi.fn(),
  switchDangerLevelMock: vi.fn(),
}))

vi.mock('../../lib/ws', () => ({
  wsClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    subscribe: vi.fn(),
    onStatusChange: vi.fn(),
  },
}))

interface MockStore {
  (selector?: (state: any) => any): any
  setState: (partial: Record<string, any>) => void
}

function mockStore(initial: Record<string, any>): MockStore {
  let state = { ...initial }
  const fn = vi.fn((selector?: (s: typeof state) => any) => {
    return selector ? selector(state) : state
  }) as unknown as MockStore
  fn.setState = (partial: Record<string, any>) => {
    state = { ...state, ...partial }
  }
  return fn
}

vi.mock('../../stores/session', () => ({
  useSessionStore: mockStore({
    confirmPath: confirmPathMock,
    switchDangerLevel: switchDangerLevelMock,
  }),
}))

vi.mock('../../stores/session/session-scope', () => ({
  useSessionScope: () => 'session-1',
}))

vi.mock('./ScrollArea', () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('./icons', () => ({
  WarningSmallIcon: () => <span data-testid="warning-icon" />,
}))

import { PathConfirmationButtons } from './PathConfirmationButtons'
import type { PendingPathConfirmation } from '../../stores/session'

function renderConfirmation(reason: PendingPathConfirmation['reason']): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const confirmation: PendingPathConfirmation = {
    callId: 'call-1',
    tool: 'read_file',
    paths: ['/some/path'],
    workdir: '/workdir',
    reason,
  }
  act(() => {
    root.render(<PathConfirmationButtons confirmation={confirmation} />)
  })
  return container
}

function getButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
}

function getButtonByText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return getButtons(container).find((b) => b.textContent?.includes(text))
}

beforeEach(() => {
  confirmPathMock.mockClear()
  switchDangerLevelMock.mockClear()
})

describe('PathConfirmationButtons', () => {
  it('renders "Allow for this session" button for rule_ask', () => {
    const container = renderConfirmation('rule_ask')
    expect(getButtonByText(container, 'Allow for this session')).toBeDefined()
  })

  it('renders "Allow for this session" button for outside_workdir', () => {
    const container = renderConfirmation('outside_workdir')
    expect(getButtonByText(container, 'Allow for this session')).toBeDefined()
  })

  it('renders "Allow for this session" button for sensitive_file', () => {
    const container = renderConfirmation('sensitive_file')
    expect(getButtonByText(container, 'Allow for this session')).toBeDefined()
  })

  it('hides "Allow for this session" button for dangerous_command (no persistent allow)', () => {
    const container = renderConfirmation('dangerous_command')
    const btn = getButtonByText(container, 'Allow for this session')
    expect(btn?.className).toContain('hidden')
  })

  it('hides "Allow for this session" button for git_no_verify (no persistent allow)', () => {
    const container = renderConfirmation('git_no_verify')
    const btn = getButtonByText(container, 'Allow for this session')
    expect(btn?.className).toContain('hidden')
  })

  it('clicking "Allow for this session" calls confirmPath with alwaysAllow=true', () => {
    const container = renderConfirmation('rule_ask')
    const btn = getButtonByText(container, 'Allow for this session')!
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(confirmPathMock).toHaveBeenCalledWith('session-1', 'call-1', true, true)
  })

  it('clicking "Allow for this session" does NOT switch dangerous mode', () => {
    const container = renderConfirmation('rule_ask')
    const btn = getButtonByText(container, 'Allow for this session')!
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(switchDangerLevelMock).not.toHaveBeenCalled()
  })

  it('clicking "Allow" calls confirmPath with alwaysAllow=false', () => {
    const container = renderConfirmation('rule_ask')
    const btn = getButtonByText(container, 'Allow')!
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(confirmPathMock).toHaveBeenCalledWith('session-1', 'call-1', true, false)
  })

  it('clicking "Deny" calls confirmPath with approved=false', () => {
    const container = renderConfirmation('rule_ask')
    const btn = getButtonByText(container, 'Deny')!
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(confirmPathMock).toHaveBeenCalledWith('session-1', 'call-1', false)
  })

  it('"Allow Everything" button is present and switches dangerous mode', () => {
    const container = renderConfirmation('rule_ask')
    const btn = getButtonByText(container, 'Allow Everything')!
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(switchDangerLevelMock).toHaveBeenCalledWith('session-1', 'dangerous')
    expect(confirmPathMock).toHaveBeenCalledWith('session-1', 'call-1', true, false)
  })

  it('"Allow Everything" is hidden for git_no_verify', () => {
    const container = renderConfirmation('git_no_verify')
    const btn = getButtonByText(container, 'Allow Everything')
    expect(btn?.className).toContain('hidden')
  })
})
