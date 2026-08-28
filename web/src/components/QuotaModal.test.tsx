// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mockAuthFetch = vi.fn()
vi.mock('../lib/api', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}))

import { QuotaModal } from './QuotaModal'
import { useQuotaStore } from '../stores/quota'

interface MockStore {
  (selector?: (state: any) => any): any
  setState: (partial: Record<string, any>) => void
}

const mountedRoots: Array<{ root: ReturnType<typeof createRoot>; container: HTMLElement }> = []

function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push({ root, container })
  act(() => {
    root.render(ui)
  })
  return document.body
}

afterEach(() => {
  for (const { root } of mountedRoots.splice(0)) {
    act(() => {
      root.unmount()
    })
  }
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

function mockQuotaStore(report: unknown, opts: { loading?: boolean; error?: string | null } = {}) {
  ;(useQuotaStore as unknown as MockStore).setState({
    report,
    loading: opts.loading ?? false,
    error: opts.error ?? null,
    lastFetched: report ? Date.now() : null,
    fetchQuota: vi.fn(),
  })
}

const WINDOWED_REPORT = {
  sources: [
    {
      id: 'opencode-go',
      name: 'OpenCode Go',
      metrics: [
        {
          kind: 'windowed',
          label: 'Requests',
          used: 142,
          limit: 500,
          window: 'hour',
          resetsAt: new Date(Date.now() + 3600_000).toISOString(),
        },
        { kind: 'windowed', label: 'Requests', used: 3200, limit: 10000, window: 'week' },
        { kind: 'windowed', label: 'Requests', used: 11800, limit: 40000, window: 'month' },
      ],
    },
  ],
  fetchedAt: new Date().toISOString(),
}

const PER_MODEL_REPORT = {
  sources: [
    {
      id: 'google-antigravity',
      name: 'Google Antigravity',
      metrics: [
        { kind: 'windowed', label: 'Requests', used: 80, limit: 200, window: 'hour', model: 'gemini' },
        { kind: 'windowed', label: 'Requests', used: 35, limit: 200, window: 'hour', model: 'claude' },
      ],
    },
  ],
  fetchedAt: new Date().toISOString(),
}

const TOKEN_BALANCE_REPORT = {
  sources: [
    {
      id: 'github-copilot-business',
      name: 'GitHub Copilot Business',
      metrics: [{ kind: 'token-balance', label: 'Tokens', total: 1_000_000, remaining: 412_500 }],
    },
  ],
  fetchedAt: new Date().toISOString(),
}

describe('QuotaModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing visible when closed', async () => {
    mockQuotaStore(null)
    ;(useQuotaStore as unknown as MockStore).setState({
      report: null,
      loading: false,
      error: null,
      fetchQuota: vi.fn(),
    })
    const container = render(<QuotaModal isOpen={false} onClose={vi.fn()} />)
    expect(container.textContent).not.toContain('Usage & Quotas')
  })

  it('fetches quota when opened', async () => {
    const fetchQuota = vi.fn()
    mockQuotaStore(null)
    ;(useQuotaStore as unknown as MockStore).setState({ report: null, loading: false, error: null, fetchQuota })
    render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(fetchQuota).toHaveBeenCalled()
  })

  it('renders windowed metrics with used/limit and window label', async () => {
    mockQuotaStore(WINDOWED_REPORT)
    const container = render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(container.textContent).toContain('OpenCode Go')
    expect(container.textContent).toContain('142')
    expect(container.textContent).toContain('500')
    expect(container.textContent).toContain('per hour')
    expect(container.textContent).toContain('per week')
    expect(container.textContent).toContain('per month')
  })

  it('renders per-model windowed metrics', async () => {
    mockQuotaStore(PER_MODEL_REPORT)
    const container = render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(container.textContent).toContain('Google Antigravity')
    expect(container.textContent).toContain('gemini')
    expect(container.textContent).toContain('claude')
  })

  it('renders token-balance metrics with remaining/total', async () => {
    mockQuotaStore(TOKEN_BALANCE_REPORT)
    const container = render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(container.textContent).toContain('GitHub Copilot Business')
    expect(container.textContent).toContain('412,500')
    expect(container.textContent).toContain('1,000,000')
    expect(container.textContent).toContain('left')
    expect(container.textContent).toContain('% left')
  })

  it('shows a warning when a metric is over limit', async () => {
    mockQuotaStore({
      sources: [
        {
          id: 'github-copilot-business',
          name: 'GitHub Copilot Business',
          metrics: [{ kind: 'token-balance', label: 'Tokens', total: 100, remaining: 0 }],
        },
      ],
      fetchedAt: new Date().toISOString(),
    })
    const container = render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(container.textContent).toContain('Limit')
    expect(container.textContent).toContain('One or more quotas have reached their limit')
  })

  it('shows an error message when the store has an error', async () => {
    mockQuotaStore(null, { error: 'HTTP 500' })
    const container = render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(container.textContent).toContain('Failed to load quota')
  })
})
