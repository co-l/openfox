/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolsTab } from './ToolsTab'

const { mockSettings, mockSetSetting } = vi.hoisted(() => ({
  mockSettings: {} as Record<string, string>,
  mockSetSetting: vi.fn(),
}))

vi.mock('../../../hooks/useSetting', () => ({
  useSetting: (key: string, fallback = '') => ({ value: mockSettings[key] ?? fallback, loading: false }),
}))

vi.mock('../../../lib/resources', async (importOriginal) => ({
  ...(await importOriginal()),
  setSetting: mockSetSetting,
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
    expect(toggles.length).toBe(3)
    await user.click(toggles[1]!)

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
    expect(toggles.length).toBe(3)
    await user.click(toggles[2]!)

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

describe('ToolsTab RTK shell hint (Windows)', () => {
  const HINT_PATTERN = /RTK only rewrites Unix-style commands/

  const mockFetchWithShells = async (shells: { id: string; label: string; available: boolean }[]) => {
    const { authFetch } = await import('../../../lib/api')
    const mockFn = authFetch as ReturnType<typeof vi.fn>
    mockFn.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url === '/api/tools/shells') return { shells }
        if (url === '/api/tools/rtk-check') return { available: true }
        return { servers: [] }
      },
    }))
  }

  const WINDOWS_SHELLS = [
    { id: 'cmd', label: 'cmd.exe', available: true },
    { id: 'powershell', label: 'PowerShell', available: true },
    { id: 'gitbash', label: 'Git Bash', available: true },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    cleanup()
    delete mockSettings['tools.useRtk']
    delete mockSettings['tools.shell']
    delete mockSettings['search.engine']
    delete mockSettings['search.tavilyApiKey']
    delete mockSettings['search.searxngUrl']
    delete mockSettings['search.searxngApiKey']
  })

  it('shows the hint when RTK is enabled with cmd.exe', async () => {
    await mockFetchWithShells(WINDOWS_SHELLS)
    mockSettings['tools.useRtk'] = 'true'
    mockSettings['tools.shell'] = 'cmd'
    render(<ToolsTab />)
    await screen.findByText('cmd.exe')
    expect(screen.getByText(HINT_PATTERN)).toBeDefined()
  })

  it('shows the hint when RTK is enabled with PowerShell', async () => {
    await mockFetchWithShells(WINDOWS_SHELLS)
    mockSettings['tools.useRtk'] = 'true'
    mockSettings['tools.shell'] = 'powershell'
    render(<ToolsTab />)
    await screen.findByText('Git Bash')
    expect(screen.getByText(HINT_PATTERN)).toBeDefined()
  })

  it('hides the hint when the selected shell is Git Bash', async () => {
    await mockFetchWithShells(WINDOWS_SHELLS)
    mockSettings['tools.useRtk'] = 'true'
    mockSettings['tools.shell'] = 'gitbash'
    render(<ToolsTab />)
    await screen.findByText('cmd.exe')
    expect(screen.queryByText(HINT_PATTERN)).toBeNull()
  })

  it('hides the hint when RTK is disabled', async () => {
    await mockFetchWithShells(WINDOWS_SHELLS)
    mockSettings['tools.useRtk'] = 'false'
    mockSettings['tools.shell'] = 'cmd'
    render(<ToolsTab />)
    await screen.findByText('cmd.exe')
    expect(screen.queryByText(HINT_PATTERN)).toBeNull()
  })

  it('hides the hint on non-Windows platforms (no shells)', async () => {
    await mockFetchWithShells([])
    mockSettings['tools.useRtk'] = 'true'
    render(<ToolsTab />)
    await screen.findByText('Enable RTK auto-rewrite')
    expect(screen.queryByText(HINT_PATTERN)).toBeNull()
  })
})

describe('ToolsTab Search Engine settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    delete mockSettings['search.engine']
    delete mockSettings['search.tavilyApiKey']
    delete mockSettings['search.searxngUrl']
    delete mockSettings['search.searxngApiKey']
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('loads Tavily API key from settings even if search engine is not selected', async () => {
    mockSettings['search.tavilyApiKey'] = 'tvly-saved-key-123'
    mockSettings['search.engine'] = 'tavily'
    render(<ToolsTab />)
    const input = screen.getByPlaceholderText('tvly-...') as HTMLInputElement
    expect(input.value).toBe('tvly-saved-key-123')
  })

  it('persists typed Tavily API key via debounced save', async () => {
    mockSettings['search.engine'] = 'tavily'
    const { fireEvent } = await import('@testing-library/react')
    render(<ToolsTab />)
    const input = screen.getByPlaceholderText('tvly-...') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'tvly-new-key-456' } })

    expect(mockSetSetting).not.toHaveBeenCalledWith('search.tavilyApiKey', 'tvly-new-key-456')
    vi.advanceTimersByTime(300)
    expect(mockSetSetting).toHaveBeenCalledWith('search.tavilyApiKey', 'tvly-new-key-456')
  })
})
