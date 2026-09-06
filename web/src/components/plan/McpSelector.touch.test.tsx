/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { clearCache } from '../../lib/resourceCache'
import { mcpServersResource } from '../../lib/resources'

vi.mock('../../hooks/useIsTouchDevice', () => ({ useIsTouchDevice: () => true }))

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({ disabledServers: [] }) })),
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: vi.fn((selector: (state: unknown) => unknown) => selector({ currentSession: { id: 'session-1' } })),
  useIsRunning: vi.fn(() => false),
}))

import { McpSelector } from './McpSelector'

describe('McpSelector touch modal panel', () => {
  beforeEach(() => {
    clearCache()
    mcpServersResource.write([
      {
        name: 'alpha',
        status: 'connected',
        tools: [{ name: 'tool-a', enabled: true, estimatedTokens: 100 }],
        estimatedTokens: 100,
        config: {},
      },
    ])
  })
  afterEach(cleanup)

  it('renders a viewport-contained modal panel on touch', () => {
    render(<McpSelector />)
    fireEvent.click(screen.getByText(/MCP/))
    expect(screen.getByTestId('mcp-dropdown').getAttribute('data-panel')).toBe('modal')
  })
})
