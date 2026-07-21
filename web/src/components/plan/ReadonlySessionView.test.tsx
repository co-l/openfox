// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { authFetch } from '../../lib/api'

vi.mock('wouter', () => ({
  useRoute: () => [true, { projectId: 'proj-1', sessionId: 'session-1' }],
}))

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
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
  useSettingsStore: Object.assign(
    vi.fn(() => ({
      settings: {},
      loading: {},
      getSettings: vi.fn(),
    })),
    { getState: () => ({ getSettings: vi.fn() }) },
  ),
  DISPLAY_SETTINGS_KEYS: ['display.showThinking'],
  SETTINGS_KEYS: { DISPLAY_MAX_VISIBLE_ITEMS: 'display.maxVisibleItems' },
}))

vi.mock('./ChatFeedItems', () => ({
  ChatFeedItems: () => <div>ChatFeedItems</div>,
}))

vi.mock('../shared/Spinner', () => ({
  Spinner: () => <div>Loading...</div>,
}))

vi.mock('./groupMessages', () => ({
  groupMessages: (messages: unknown[]) => messages as { id: string; role: string }[],
}))

import { ReadonlySessionView } from './ReadonlySessionView'

describe('ReadonlySessionView — server-side truncation', () => {
  it('shows loading state on mount', () => {
    vi.mocked(authFetch).mockResolvedValue(new Response('{}', { status: 200 }))
    render(<ReadonlySessionView />)
    expect(screen.getByText('Loading...')).toBeDefined()
  })

  it('displays hiddenCount from server response in the header', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          session: { id: 'session-1', metadata: { title: 'Test' } },
          messages: [{ id: 'msg-1', role: 'user', content: 'Hi', timestamp: new Date().toISOString() }],
          hiddenCount: 5,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    render(<ReadonlySessionView />)

    await waitFor(() => {
      expect(screen.getByText(/5 older hidden/)).toBeDefined()
    })
  })
})
