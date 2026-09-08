/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { clearCache } from '../../lib/resourceCache'
import { mcpServersResource } from '../../lib/resources'

let isTouch = true
vi.mock('../../hooks/useIsTouchDevice', () => ({ useIsTouchDevice: () => isTouch }))

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({ disabledServers: [] }) })),
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: vi.fn((selector: (state: unknown) => unknown) => selector({ currentSession: { id: 'session-1' } })),
  useIsRunning: vi.fn(() => false),
}))

import { McpSelector } from './McpSelector'

describe('McpSelector panel', () => {
  beforeEach(() => {
    isTouch = true
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

  it('left-aligns the anchored panel on narrow containers so it stays in view', () => {
    isTouch = false
    render(<McpSelector />)
    fireEvent.click(screen.getByText(/MCP/))
    const panel = screen.getByTestId('mcp-dropdown')
    expect(panel.getAttribute('data-panel')).toBe('anchored')
    expect(panel.className).toContain('left-0')
    expect(panel.className).toContain('@md:right-0')
  })
})
