/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolsTab } from './ToolsTab'

const mockSettings: Record<string, string> = {}
const mockGetSetting = vi.fn()
const mockSetSetting = vi.fn()

vi.mock('../../../stores/settings', () => ({
  SETTINGS_KEYS: {
    SEARCH_ENGINE: 'search.engine',
    SEARCH_TAVILY_API_KEY: 'search.tavilyApiKey',
    SEARCH_SEARXNG_URL: 'search.searxngUrl',
    SEARCH_SEARXNG_API_KEY: 'search.searxngApiKey',
    TOOLS_USE_RTK: 'tools.useRtk',
    CONFIRM_ON_WORKSPACE_ACTIONS: 'confirm.onWorkspaceActions',
    TOOLS_SHELL: 'tools.shell',
  },
  useSettingsStore: vi.fn((selector) => {
    const state = { settings: mockSettings, getSetting: mockGetSetting, setSetting: mockSetSetting }
    return selector(state)
  }),
}))

vi.mock('../useSettingsStore', () => ({
  useSettingsStoreState: () => ({
    settings: mockSettings,
    getSetting: mockGetSetting,
    setSetting: mockSetSetting,
  }),
}))

vi.mock('wouter', () => ({ useLocation: () => ['/', vi.fn()] }))

vi.mock('../../../lib/api', () => ({
  authFetch: vi.fn(async (_url: string, _options?: RequestInit) => ({
    ok: true,
    json: async () => ({
      servers: [
        {
          name: 'server-a',
          status: 'connected',
          tools: [{ name: 'tool1', enabled: true }],
          estimatedTokens: 100,
          config: { transport: 'stdio' },
        },
        {
          name: 'server-b',
          status: 'connected',
          tools: [{ name: 'tool2', enabled: true }],
          estimatedTokens: 200,
          config: { transport: 'stdio' },
        },
      ],
    }),
  })),
}))

vi.mock('../../../hooks/useTestButton', () => ({
  useTestButton: () => ['Test', null, false, vi.fn()],
}))

vi.mock('../../shared/CRUDListView', () => ({
  CRUDListView: ({
    children,
    loading,
    hasItems,
    loadingLabel,
    emptyLabel,
  }: {
    children: React.ReactNode
    loading: boolean
    hasItems: boolean
    loadingLabel: string
    emptyLabel: string
  }) => {
    if (loading) return <div>{loadingLabel}</div>
    if (!hasItems) return <div>{emptyLabel}</div>
    return <div>{children}</div>
  },
}))

vi.mock('../../shared/Button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

vi.mock('../../shared/Input', () => ({
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
  }) => <input value={value} onChange={onChange} placeholder={placeholder} />,
}))

vi.mock('../CRUDModal', () => ({
  useConfirmDialog: () => ({ requestDelete: vi.fn(), clearConfirm: vi.fn(), isConfirming: vi.fn(() => false) }),
  FormField: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div>
      <label>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  ),
  ErrorBanner: ({ message }: { message: string }) => <div role="alert">{message}</div>,
}))

vi.mock('../../shared/SelfContainedModal', () => ({
  Modal: ({ isOpen, children, title }: { isOpen: boolean; children: React.ReactNode; title: string }) => {
    if (!isOpen) return null
    return (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    )
  },
}))

describe('ToolsTab MCP server toggle isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    cleanup()
  })

  it('should render server list', async () => {
    render(<ToolsTab />)
    await screen.findByText('server-a')
    expect(screen.getByText('server-b')).toBeDefined()
  })

  it('toggling server-a sends PUT to correct endpoint with disabled:true', async () => {
    const user = userEvent.setup()
    render(<ToolsTab />)
    await screen.findByText('server-a')

    // The first MCP server toggle is inside the server-a row. Find all toggles
    // in the MCP section (skip RTK and confirmation toggles before it).
    const mcpSectionEl = screen.getByTestId('mcp-servers-heading').closest('div')!.parentElement!
    const toggles = mcpSectionEl.querySelectorAll('button[role="switch"]')
    expect(toggles.length).toBe(2)
    await user.click(toggles[0]!)

    const { authFetch } = await import('../../../lib/api')
    const mockFn = authFetch as ReturnType<typeof vi.fn>
    const putCalls = mockFn.mock.calls.filter(
      (call: unknown[]) => (call[1] as Record<string, unknown>)?.method === 'PUT',
    )
    expect(putCalls.length).toBe(1)
    expect(putCalls[0]![0] as string).toContain('server-a')
    expect(JSON.parse((putCalls[0]![1] as Record<string, string>).body as string)).toEqual({ disabled: true })
  })

  it('toggling server-b sends PUT to correct endpoint with disabled:true', async () => {
    const user = userEvent.setup()
    render(<ToolsTab />)
    await screen.findByText('server-b')

    const mcpSectionEl = screen.getByTestId('mcp-servers-heading').closest('div')!.parentElement!
    const toggles = mcpSectionEl.querySelectorAll('button[role="switch"]')
    expect(toggles.length).toBe(2)
    await user.click(toggles[1]!)

    const { authFetch } = await import('../../../lib/api')
    const mockFn = authFetch as ReturnType<typeof vi.fn>
    const putCalls = mockFn.mock.calls.filter(
      (call: unknown[]) => (call[1] as Record<string, unknown>)?.method === 'PUT',
    )
    expect(putCalls.length).toBe(1)
    expect(putCalls[0]![0] as string).toContain('server-b')
    expect(JSON.parse((putCalls[0]![1] as Record<string, string>).body as string)).toEqual({ disabled: true })
  })
})
