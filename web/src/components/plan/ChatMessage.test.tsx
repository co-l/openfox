// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatMessage } from './ChatMessage'
import { AUTOSCROLL_REARM_EVENT } from './feed-window'
import type { Attachment, Message } from '@shared/types.js'

const { mockReplayMessage, mockLoadSession, mockForkSession, mockForkSessionErrorMessage } = vi.hoisted(() => ({
  mockReplayMessage: vi.fn(),
  mockLoadSession: vi.fn(),
  mockForkSession: vi.fn(),
  mockForkSessionErrorMessage: vi.fn((result: unknown) =>
    result && typeof result === 'object' && 'error' in result ? (result as { error: string }).error : null,
  ),
}))

vi.mock('../../lib/api.js', () => ({
  replayMessage: mockReplayMessage,
  forkSession: mockForkSession,
  forkSessionErrorMessage: mockForkSessionErrorMessage,
}))

vi.mock('wouter', () => ({
  useLocation: () => ['/', vi.fn()],
}))

vi.mock('../../stores/session.js', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      loadSession: mockLoadSession,
      currentSession: null,
      messages: [],
      visionFallbackByMessage: {},
    }),
}))

vi.mock('../../lib/clipboard.js', () => ({
  copyToClipboard: vi.fn(async () => {}),
}))

function att(id: string, filename: string): Attachment {
  return { id, filename, mimeType: 'text/plain', size: 10, data: 'file-content' }
}

function userMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'user',
    content: 'Fix the login bug',
    timestamp: new Date().toISOString(),
    isStreaming: false,
    ...overrides,
  }
}

function collectRearmEvents() {
  let dispatched = 0
  const handler = () => {
    dispatched += 1
  }
  window.addEventListener(AUTOSCROLL_REARM_EVENT, handler)
  return {
    get dispatched() {
      return dispatched
    },
    dispose: () => window.removeEventListener(AUTOSCROLL_REARM_EVENT, handler),
  }
}

beforeEach(() => {
  mockReplayMessage.mockReset().mockResolvedValue(true)
  mockLoadSession.mockReset().mockResolvedValue(undefined)
  mockForkSession.mockReset().mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
})

describe('ChatMessage replay and edit controls', () => {
  it('re-activates auto-scroll when the user replays a prompt', async () => {
    const events = collectRearmEvents()
    render(<ChatMessage message={userMessage()} messageId="m1" sessionId="s1" />)
    fireEvent.click(screen.getByTitle('Replay'))
    await waitFor(() => expect(events.dispatched).toBe(1))
    expect(mockReplayMessage).toHaveBeenCalledWith('s1', 'm1')
    events.dispose()
  })

  it('re-activates auto-scroll when resending an edited prompt', async () => {
    const events = collectRearmEvents()
    render(<ChatMessage message={userMessage()} messageId="m1" sessionId="s1" />)
    fireEvent.click(screen.getByTitle('Edit & resend'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Better prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(events.dispatched).toBe(1))
    expect(mockReplayMessage).toHaveBeenCalledWith('s1', 'm1', 'Better prompt', [])
    events.dispose()
  })

  it('labels the edit-mode actions Cancel and Send', () => {
    render(<ChatMessage message={userMessage()} messageId="m1" sessionId="s1" />)
    fireEvent.click(screen.getByTitle('Edit & resend'))
    expect(screen.getByText('Cancel')).toBeTruthy()
    expect(screen.getByText('Send')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
  })

  it('shows the message sent timestamp in the right-click menu', () => {
    render(<ChatMessage message={userMessage({ timestamp: '2026-08-16T14:44:00' })} messageId="m1" sessionId="s1" />)
    fireEvent.contextMenu(screen.getByText('Fix the login bug'))
    expect(screen.getByText('2026/08/16 14:44')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '2026/08/16 14:44' })).toBeNull()
  })

  it('surfaces the server error message when forking fails', async () => {
    mockForkSession.mockResolvedValue({
      error: 'Message m1 belongs to a compacted context window; only the latest context window can be forked',
    })
    render(<ChatMessage message={userMessage()} messageId="m1" sessionId="s1" />)
    fireEvent.contextMenu(screen.getByText('Fix the login bug'))
    fireEvent.click(screen.getByText('Fork session from here'))
    await waitFor(() => expect(screen.getByText(/compacted context window/)).toBeTruthy())
    expect(mockForkSession).toHaveBeenCalledWith('s1', 'm1')
  })

  it('shows the attachment while editing and lets it be removed', async () => {
    render(
      <ChatMessage
        message={userMessage({ attachments: [att('a1', 'report.txt'), att('a2', 'image.png')] })}
        messageId="m1"
        sessionId="s1"
      />,
    )
    fireEvent.click(screen.getByTitle('Edit & resend'))
    expect(screen.getByText('report.txt')).toBeTruthy()
    expect(screen.getByText('image.png')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove report.txt' }))
    expect(screen.queryByText('report.txt')).toBeNull()
    expect(screen.getByText('image.png')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(mockReplayMessage).toHaveBeenCalledWith('s1', 'm1', 'Edited prompt', [att('a2', 'image.png')]),
    )
  })
})
