/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PermissionsTab } from './PermissionsTab'
import { usePermissionsStore } from '../../../stores/permissions'
import type { PermissionConfig } from '@shared/permissions.js'

vi.mock('../../../lib/api', () => ({
  authFetch: vi.fn(),
}))

vi.mock('../../../lib/ws', () => ({
  wsClient: { send: vi.fn() },
}))

vi.mock('../../../stores/session', () => ({
  useSessionStore: vi.fn((selector) => {
    const state = { currentSession: { workdir: '/test-workdir' } }
    return selector ? selector(state) : state
  }),
}))

const mockAuthFetch = vi.mocked(await import('../../../lib/api').then((m) => m.authFetch))

function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mockConfigByScope(global?: Partial<PermissionConfig>, project?: Partial<PermissionConfig>) {
  mockAuthFetch.mockImplementation(async (url: string) => {
    if (url.includes('scope=global')) {
      return createJsonResponse({ config: { version: 1, rules: [], ...global } })
    }
    if (url.includes('scope=project')) {
      return createJsonResponse({ config: { version: 1, rules: [], ...project } })
    }
    if (url.includes('/api/tools')) {
      return createJsonResponse({ tools: [] })
    }
    return createJsonResponse({ config: { version: 1, rules: [] } })
  })
}

beforeEach(() => {
  mockAuthFetch.mockReset()
  usePermissionsStore.setState({
    globalConfig: null,
    projectConfig: null,
    mergedRules: [],
    loading: false,
    saving: false,
    error: null,
    grants: [],
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PermissionsTab', () => {
  it('shows empty state when no rules', async () => {
    mockAuthFetch.mockResolvedValue(createJsonResponse({ config: { version: 1, rules: [] } }))
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText(/No permission rules/i)).toBeDefined()
    })
  })

  it('renders merged rules with scope badges', async () => {
    const globalConfig: PermissionConfig = {
      version: 1,
      rules: [{ id: 'g1', effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
    }
    const projectConfig: PermissionConfig = {
      version: 1,
      rules: [{ id: 'p1', effect: 'ALLOW', tool: 'read_file', pattern: '/ubiquity/**' }],
    }
    mockConfigByScope(globalConfig, projectConfig)
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText('rm -rf *')).toBeDefined()
      expect(screen.getByText('/ubiquity/**')).toBeDefined()
      expect(screen.getByText('global')).toBeDefined()
      expect(screen.getByText('project')).toBeDefined()
    })
  })

  it('effect badges show correct colors (DENY=red, ALLOW=green, ASK=amber)', async () => {
    const globalConfig: PermissionConfig = {
      version: 1,
      rules: [{ id: 'g1', effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
    }
    mockConfigByScope(globalConfig)
    render(<PermissionsTab />)
    await waitFor(() => {
      // The effect filter chips repeat the label; the badge is the <span>.
      const denyBadge = screen.getAllByText('DENY').find((el) => el.tagName === 'SPAN')
      expect(denyBadge?.className).toContain('red')
    })
  })

  it('add rule opens form with scope field', async () => {
    mockAuthFetch.mockResolvedValue(createJsonResponse({ config: { version: 1, rules: [] } }))
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText(/No permission rules/i)).toBeDefined()
    })

    const user = userEvent.setup()
    await user.click(screen.getByText(/Add Rule/i))
    await waitFor(() => {
      expect(screen.getByText('Effect')).toBeDefined()
      expect(screen.getByText('Tool')).toBeDefined()
      expect(screen.getByText('Scope')).toBeDefined()
    })
  })

  it('delete rule shows confirm modal then removes', async () => {
    const globalConfig: PermissionConfig = {
      version: 1,
      rules: [{ id: 'g1', effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
    }
    mockConfigByScope(globalConfig)
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText('rm -rf *')).toBeDefined()
    })

    mockAuthFetch.mockResolvedValueOnce(createJsonResponse({ config: { version: 1, rules: [] } }))

    const user = userEvent.setup()
    const deleteButton = screen.getByTitle(/delete/i)
    await user.click(deleteButton)
    await waitFor(() => {
      expect(screen.getByText('Delete rule?')).toBeDefined()
    })
    const confirmBtn = screen.getByText('Delete', { selector: 'button' })
    await user.click(confirmBtn)
    await waitFor(() => {
      expect(screen.getByText(/No permission rules/i)).toBeDefined()
    })
  })

  it('renders without active session and shows note', async () => {
    const mockSessionStore = vi.mocked(await import('../../../stores/session')).useSessionStore
    const impl = (selector: unknown) => {
      const state = { currentSession: null }
      return typeof selector === 'function' ? (selector as (s: typeof state) => unknown)(state) : state
    }
    mockSessionStore.mockImplementation(impl as never)
    mockConfigByScope()
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText(/No active project/i)).toBeDefined()
    })
  })

  it('disables Project scope in add form when no active session', async () => {
    const mockSessionStore = vi.mocked(await import('../../../stores/session')).useSessionStore
    const impl = (selector: unknown) => {
      const state = { currentSession: null }
      return typeof selector === 'function' ? (selector as (s: typeof state) => unknown)(state) : state
    }
    mockSessionStore.mockImplementation(impl as never)
    mockConfigByScope()
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText(/No active project/i)).toBeDefined()
    })
    const user = userEvent.setup()
    await user.click(screen.getByText(/Add Rule/i))
    await waitFor(() => {
      const projectOption = screen.getByText(/Project \(no active session\)/) as HTMLOptionElement
      expect(projectOption.disabled).toBe(true)
    })
  })

  it('renders error state with retry button', async () => {
    mockAuthFetch.mockRejectedValue(new Error('HTTP 500'))
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText(/HTTP 500/)).toBeDefined()
      expect(screen.getByText(/Retry/i)).toBeDefined()
    })
  })

  it('displays description in RuleRow when present', async () => {
    const globalConfig: PermissionConfig = {
      version: 1,
      rules: [
        { id: 'g1', effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *', description: 'Never delete recursively' },
      ],
    }
    mockConfigByScope(globalConfig)
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText(/Never delete recursively/)).toBeDefined()
    })
  })

  it('opens the default rules when the user has none of their own', async () => {
    mockConfigByScope({ rules: [{ id: 'default-deny-x', effect: 'DENY', tool: 'run_command', pattern: 'shipped *' }] })
    render(<PermissionsTab />)
    await waitFor(() => expect(screen.getByText('shipped *')).toBeDefined())
  })

  it('folds the default rules under the user rules until toggled', async () => {
    mockConfigByScope({
      rules: [
        { id: 'mine', effect: 'ALLOW', tool: 'run_command', pattern: 'npm test' },
        { id: 'default-deny-x', effect: 'DENY', tool: 'run_command', pattern: 'shipped *' },
      ],
    })
    render(<PermissionsTab />)
    await waitFor(() => expect(screen.getByText('npm test')).toBeDefined())
    expect(screen.queryByText('shipped *')).toBeNull()
    await userEvent.click(screen.getByText(/Default rules \(1\)/))
    expect(screen.getByText('shipped *')).toBeDefined()
  })

  it('does not render description text when absent', async () => {
    const globalConfig: PermissionConfig = {
      version: 1,
      rules: [{ id: 'g1', effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
    }
    mockConfigByScope(globalConfig)
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText('rm -rf *')).toBeDefined()
    })
    expect(screen.queryByText(/Never delete recursively/)).toBeNull()
  })

  it('shows command-specific pattern hint for run_command', async () => {
    mockAuthFetch.mockResolvedValue(createJsonResponse({ config: { version: 1, rules: [] } }))
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText(/No permission rules/i)).toBeDefined()
    })
    const user = userEvent.setup()
    await user.click(screen.getByText(/Add Rule/i))
    await waitFor(() => {
      expect(screen.getByText('Effect')).toBeDefined()
    })
    const toolSelect = screen.getByDisplayValue('read_file')
    await user.selectOptions(toolSelect, 'run_command')
    await waitFor(() => {
      expect(screen.getByText(/matches anything/i)).toBeDefined()
    })
  })

  it('shows path-specific pattern hint for read_file', async () => {
    mockAuthFetch.mockResolvedValue(createJsonResponse({ config: { version: 1, rules: [] } }))
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText(/No permission rules/i)).toBeDefined()
    })
    const user = userEvent.setup()
    await user.click(screen.getByText(/Add Rule/i))
    const toolSelect = screen.getByDisplayValue('read_file')
    await user.click(toolSelect)
    await waitFor(() => {
      expect(screen.getByText(/any depth/i)).toBeDefined()
    })
  })

  it('restricts effect to DENY-only for non-pattern tools (web_fetch)', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/tools')) {
        return createJsonResponse({ tools: [{ name: 'read_file' }, { name: 'run_command' }, { name: 'web_fetch' }] })
      }
      return createJsonResponse({ config: { version: 1, rules: [] } })
    })
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText(/No permission rules/i)).toBeDefined()
    })
    const user = userEvent.setup()
    await user.click(screen.getByText(/Add Rule/i))
    await waitFor(() => {
      expect(screen.getByText('Effect')).toBeDefined()
    })
    const toolSelect = screen.getByDisplayValue('read_file')
    await user.selectOptions(toolSelect, 'web_fetch')
    await waitFor(() => {
      const effectSelect = screen.getByDisplayValue('DENY') as HTMLSelectElement
      const options = Array.from(effectSelect.options).map((o) => o.value)
      expect(options).toEqual(['DENY'])
    })
  })

  it('disables pattern input for non-pattern tools (web_fetch)', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/tools')) {
        return createJsonResponse({ tools: [{ name: 'read_file' }, { name: 'run_command' }, { name: 'web_fetch' }] })
      }
      return createJsonResponse({ config: { version: 1, rules: [] } })
    })
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText(/No permission rules/i)).toBeDefined()
    })
    const user = userEvent.setup()
    await user.click(screen.getByText(/Add Rule/i))
    await waitFor(() => {
      expect(screen.getByText('Effect')).toBeDefined()
    })
    const toolSelect = screen.getByDisplayValue('read_file')
    await user.selectOptions(toolSelect, 'web_fetch')
    await waitFor(() => {
      const patternInput = screen.getByPlaceholderText('N/A') as HTMLInputElement
      expect(patternInput.disabled).toBe(true)
    })
  })
})

describe('PermissionsTab session grants', () => {
  const grants = [
    {
      sessionId: 'sess-1234567890',
      paths: [
        {
          path: '/home/u/.ssh/id_rsa',
          grantedAt: 1_700_000_000_000,
          tool: 'read_file',
          reason: 'sensitive_file',
        },
      ],
      rules: [{ effect: 'ALLOW', tool: 'read_file', pattern: '**/.ssh/**', grantedAt: 1_700_000_000_000 }],
    },
  ]

  function mockWithGrants(initial: unknown[], afterRevoke: unknown[] = []) {
    mockAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/permissions/grants')) {
        if (init?.method === 'DELETE') return createJsonResponse({ grants: afterRevoke })
        return createJsonResponse({ grants: initial })
      }
      return createJsonResponse({ config: { version: 1, rules: [] } })
    })
  }

  it('shows an empty state when nothing was granted', async () => {
    mockWithGrants([])
    render(<PermissionsTab />)
    await waitFor(() => expect(screen.getByText('No active session grants.')).toBeDefined())
  })

  it('lists the granted paths and promoted rules of each session', async () => {
    mockWithGrants(grants)
    render(<PermissionsTab />)
    await waitFor(() => {
      expect(screen.getByText('/home/u/.ssh/id_rsa')).toBeDefined()
      expect(screen.getByText(/\*\*\/\.ssh\/\*\*/)).toBeDefined()
      expect(screen.getByText('Session sess-123')).toBeDefined()
    })
  })

  it('tells what each grant allows, why it exists and that it is temporary', async () => {
    mockWithGrants(grants)
    render(<PermissionsTab />)
    await waitFor(() => expect(screen.getByText('/home/u/.ssh/id_rsa')).toBeDefined())
    expect(screen.getByText(/allows read, write and commands on this path/)).toBeDefined()
    expect(screen.getByText(/approved on read \(read_file\)/)).toBeDefined()
    expect(screen.getByText(/sensitive file/)).toBeDefined()
    expect(screen.getByText(/allows read only/)).toBeDefined()
    expect(screen.getAllByText('Session').length).toBeGreaterThanOrEqual(2)
  })

  it('revokes one path with a DELETE and shows the grants the server returns', async () => {
    mockWithGrants(grants, [])
    const user = userEvent.setup()
    render(<PermissionsTab />)
    await waitFor(() => expect(screen.getByText('/home/u/.ssh/id_rsa')).toBeDefined())
    // Rules are listed before paths: the path revoke button is the second one.
    await user.click(screen.getAllByTitle('Revoke')[1]!)
    await waitFor(() => expect(screen.getByText('No active session grants.')).toBeDefined())
    const call = mockAuthFetch.mock.calls.find(([, init]) => init?.method === 'DELETE')!
    expect(call[0]).toBe(
      `/api/permissions/grants/sess-1234567890/paths?path=${encodeURIComponent('/home/u/.ssh/id_rsa')}`,
    )
  })

  it('revokes a promoted rule by tool and pattern', async () => {
    mockWithGrants(grants, [])
    const user = userEvent.setup()
    render(<PermissionsTab />)
    await waitFor(() => expect(screen.getByText(/\*\*\/\.ssh\/\*\*/)).toBeDefined())
    await user.click(screen.getAllByTitle('Revoke')[0]!)
    await waitFor(() => {
      const call = mockAuthFetch.mock.calls.find(([, init]) => init?.method === 'DELETE')
      expect(call?.[0]).toBe(
        `/api/permissions/grants/sess-1234567890/rules?tool=read_file&pattern=${encodeURIComponent('**/.ssh/**')}`,
      )
    })
  })
})
