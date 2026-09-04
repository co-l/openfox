// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { setLocale } from '@shared/i18n/index.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mockAuthFetch = vi.fn()
vi.mock('../lib/api', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}))

const mockQuotaState = {
  report: null as any,
  loading: false,
  error: null as any,
  refresh: vi.fn(),
  hasWarning: false,
}

vi.mock('../hooks/useQuota', () => ({
  useQuota: () => ({
    report: mockQuotaState.report,
    loading: mockQuotaState.loading,
    error: mockQuotaState.error,
    refresh: mockQuotaState.refresh,
    hasWarning: mockQuotaState.hasWarning,
  }),
}))

import { QuotaModal } from './QuotaModal'

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
  setLocale('en')
})

function setQuotaData(report: any, opts: { loading?: boolean; error?: string | null } = {}) {
  mockQuotaState.report = report
  mockQuotaState.loading = opts.loading ?? false
  mockQuotaState.error = opts.error ?? null
  mockQuotaState.hasWarning = (report?.sources ?? []).some((s: any) =>
    s.metrics.some((m: any) => (m.kind === 'windowed' ? m.used >= m.limit : m.remaining <= 0)),
  )
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
    setLocale('en')
    setQuotaData(null)
  })

  it('renders nothing visible when closed', async () => {
    setQuotaData(null)
    const container = render(<QuotaModal isOpen={false} onClose={vi.fn()} />)
    expect(container.textContent).not.toContain('Usage & Quotas')
  })

  it('refreshes quota when opened', async () => {
    setQuotaData(null)
    render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(mockQuotaState.refresh).toHaveBeenCalled()
  })

  it('renders windowed metrics with used/limit and window label in English', async () => {
    setQuotaData(WINDOWED_REPORT)
    const container = render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(container.textContent).toContain('OpenCode Go')
    expect(container.textContent).toContain('142')
    expect(container.textContent).toContain('500')
    expect(container.textContent).toContain('per hour')
    expect(container.textContent).toContain('per week')
    expect(container.textContent).toContain('per month')
  })

  it('renders windowed metrics in French when locale is set to fr', async () => {
    setLocale('fr')
    setQuotaData(WINDOWED_REPORT)
    const container = render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(container.textContent).toContain('OpenCode Go')
    expect(container.textContent).toContain('par heure')
    expect(container.textContent).toContain('par semaine')
    expect(container.textContent).toContain('par mois')
    expect(container.textContent).toContain('restant')
  })

  it('renders per-model windowed metrics', async () => {
    setQuotaData(PER_MODEL_REPORT)
    const container = render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(container.textContent).toContain('Google Antigravity')
    expect(container.textContent).toContain('gemini')
    expect(container.textContent).toContain('claude')
  })

  it('renders token-balance metrics with remaining/total', async () => {
    setQuotaData(TOKEN_BALANCE_REPORT)
    const container = render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(container.textContent).toContain('GitHub Copilot Business')
    expect(container.textContent).toContain('412,500')
    expect(container.textContent).toContain('1,000,000')
    expect(container.textContent).toContain('left')
    expect(container.textContent).toContain('% left')
  })

  it('shows a warning when a metric is over limit', async () => {
    setQuotaData({
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

  it('shows an error message when the hook has an error', async () => {
    setQuotaData(null, { error: 'HTTP 500' })
    const container = render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(container.textContent).toContain('Failed to load quota: HTTP 500')
  })

  it('shows empty state when report has no sources', async () => {
    setQuotaData({ sources: [], fetchedAt: new Date().toISOString() })
    const container = render(<QuotaModal isOpen onClose={vi.fn()} />)
    expect(container.textContent).toContain('No quota information available.')
  })
})
