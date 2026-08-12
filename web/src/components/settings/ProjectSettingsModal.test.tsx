// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockStoreState, mockFetchConfig, mockSaveConfig, mockUpdateProject, mockWsSend, mockAuthFetch } = vi.hoisted(
  () => {
    const state = { config: null as Record<string, unknown> | null, loading: false }
    return {
      mockStoreState: state,
      mockFetchConfig: vi.fn(),
      mockSaveConfig: vi.fn(),
      mockUpdateProject: vi.fn(),
      mockWsSend: vi.fn(),
      mockAuthFetch: vi.fn(),
    }
  },
)

const { mockDefaultAgents, mockUserAgents, mockProjectAgents, mockFetchAgents } = vi.hoisted(() => ({
  mockDefaultAgents: [
    { id: 'planner', name: 'Planner', description: '', subagent: false, allowedTools: [] },
    { id: 'builder', name: 'Builder', description: '', subagent: false, allowedTools: [] },
  ],
  mockUserAgents: [{ id: 'architect', name: 'Architect', description: '', subagent: false, allowedTools: [] }],
  mockProjectAgents: [
    { id: 'qa-lead', name: 'QA Lead', description: '', subagent: false, allowedTools: [] },
    { id: 'builder', name: 'Builder', description: '', subagent: false, allowedTools: [] },
  ],
  mockFetchAgents: vi.fn(async () => undefined),
}))

vi.mock('../../stores/agents', () => ({
  useAgentsStore: (selector: any) =>
    selector({
      defaults: mockDefaultAgents,
      userItems: mockUserAgents,
      projectItems: mockProjectAgents,
      fetchAgents: mockFetchAgents,
    }),
}))

vi.mock('../../stores/project', () => ({
  useProjectStore: (selector: any) =>
    selector({
      updateProject: mockUpdateProject,
    }),
}))

vi.mock('../../stores/workspace-config', () => ({
  useWorkspaceConfigStore: (selector: any) =>
    selector({
      config: mockStoreState.config,
      loading: mockStoreState.loading,
      fetchConfig: mockFetchConfig,
      saveConfig: mockSaveConfig,
    }),
}))

vi.mock('../../lib/api', () => ({
  authFetch: mockAuthFetch,
}))

vi.mock('../../lib/ws', () => ({
  wsClient: { send: mockWsSend },
}))

vi.mock('../shared/SelfContainedModal', () => ({
  Modal: ({ children, title, footer }: any) => (
    <div data-testid="modal" data-title={title}>
      {children}
      {footer}
    </div>
  ),
}))

vi.mock('../shared/ModalFooter', () => ({
  ModalFooter: ({ onCancel, onSave, saving, saveDisabled }: any) => (
    <div data-testid="modal-footer">
      <button data-testid="cancel-btn" onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      <button data-testid="save-btn" onClick={onSave} disabled={saveDisabled || saving}>
        Save
      </button>
    </div>
  ),
}))

import { ProjectSettingsModal } from './ProjectSettingsModal'

const defaultProject = {
  id: 'test-project',
  name: 'Test Project',
  workdir: '/tmp/test-project',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStoreState.config = null
  mockStoreState.loading = false
  mockAuthFetch.mockReset()
})

afterEach(cleanup)

describe('ProjectSettingsModal', () => {
  it('renders the workspace root directory field', () => {
    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    expect(screen.getByText('Workspace Root Directory')).toBeTruthy()
  })

  it('renders a text input for the root directory path', () => {
    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path')
    expect(input).toBeTruthy()
    expect(input.tagName).toBe('INPUT')
  })

  it('populates rootDir field from loaded config', () => {
    mockStoreState.config = { rootDir: '/custom/workspaces', setup: [] }

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path') as HTMLInputElement
    expect(input.value).toBe('/custom/workspaces')
  })

  it('clears rootDir field when config has no rootDir', () => {
    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('calls fetchConfig on open', () => {
    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    expect(mockFetchConfig).toHaveBeenCalledWith(defaultProject.workdir)
  })

  it('saves rootDir when user types and saves', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/workspace/config/validate')) {
        return { ok: true, json: () => Promise.resolve({ exists: true, workspaces: [] }) }
      }
      return { ok: true, json: () => Promise.resolve({ config: { rootDir: '/my/custom/path' } }) }
    })

    const user = userEvent.setup()

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path')
    await user.type(input, '/my/custom/path')

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    expect(mockSaveConfig).toHaveBeenCalledWith(
      defaultProject.workdir,
      expect.objectContaining({ rootDir: '/my/custom/path' }),
    )
  })

  it('sends only changed workspace fields when saving', async () => {
    const user = userEvent.setup()

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const setupInput = screen.getByPlaceholderText('npm install --prefer-offline')
    await user.type(setupInput, 'npm install')

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    expect(mockSaveConfig).toHaveBeenCalledWith(
      defaultProject.workdir,
      expect.objectContaining({ setup: ['npm install'] }),
    )
  })

  it('sends an empty setup array when the setup command is cleared', async () => {
    mockStoreState.config = { setup: ['npm install'] }

    const user = userEvent.setup()

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const setupInput = screen.getByPlaceholderText('npm install --prefer-offline')
    await user.clear(setupInput)

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    expect(mockSaveConfig).toHaveBeenCalledWith(defaultProject.workdir, expect.objectContaining({ setup: [] }))
  })

  it('does not call saveConfig when only project instructions change', async () => {
    const user = userEvent.setup()

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const instructions = screen.getByPlaceholderText('Enter project-specific instructions...')
    await user.type(instructions, 'focus on the networking stack')

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    expect(mockSaveConfig).not.toHaveBeenCalled()
    expect(mockUpdateProject).toHaveBeenCalled()
  })
})

describe('ProjectSettingsModal — default agent', () => {
  it('renders the default agent select with top-level agents', () => {
    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const select = screen.getByLabelText('Default Agent')
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toContain('Use system default')
    expect(options).toContain('Planner')
    expect(options).toContain('Builder')
    expect(options).toContain('Architect')
  })

  it('pre-selects the project default agent', () => {
    render(
      <ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={{ ...defaultProject, defaultAgent: 'builder' }} />,
    )

    expect((screen.getByLabelText('Default Agent') as HTMLSelectElement).value).toBe('builder')
  })

  it('surfaces a stored default agent that no longer exists', () => {
    render(
      <ProjectSettingsModal
        isOpen={true}
        onClose={vi.fn()}
        project={{ ...defaultProject, defaultAgent: 'vanished-agent' }}
      />,
    )

    const select = screen.getByLabelText('Default Agent') as HTMLSelectElement
    expect(select.value).toBe('vanished-agent')
    expect(screen.getByRole('option', { name: 'vanished-agent (missing agent)' })).toBeTruthy()
    expect(screen.getByText(/no longer exists/i)).toBeTruthy()
  })

  it('saves the selected default agent', async () => {
    const user = userEvent.setup()

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    await user.selectOptions(screen.getByLabelText('Default Agent'), 'architect')
    await user.click(screen.getByTestId('save-btn'))

    expect(mockUpdateProject).toHaveBeenCalledWith(
      defaultProject.id,
      expect.objectContaining({ defaultAgent: 'architect' }),
    )
  })

  it('clears the project default agent when system default is chosen', async () => {
    const user = userEvent.setup()

    render(
      <ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={{ ...defaultProject, defaultAgent: 'builder' }} />,
    )

    await user.selectOptions(screen.getByLabelText('Default Agent'), '')
    await user.click(screen.getByTestId('save-btn'))

    expect(mockUpdateProject).toHaveBeenCalledWith(defaultProject.id, expect.objectContaining({ defaultAgent: null }))
  })

  it('does not mark save disabled until the default agent changes', () => {
    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    expect((screen.getByTestId('save-btn') as HTMLButtonElement).disabled).toBe(true)
  })

  it('fetches agents scoped to the project when opened', () => {
    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    expect(mockFetchAgents).toHaveBeenCalledWith(defaultProject.workdir)
  })

  it('lists top-level project-scoped agents in the default agent select', () => {
    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const select = screen.getByLabelText('Default Agent')
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toContain('QA Lead')
  })

  it('does not list duplicate options when a project agent overrides a built-in id', () => {
    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const select = screen.getByLabelText('Default Agent') as HTMLSelectElement
    expect(Array.from(select.options).filter((o) => o.value === 'builder')).toHaveLength(1)
    expect(select.options[select.selectedIndex]?.value).toBe('')
  })

  it('groups agents by scope in the default agent select', () => {
    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const select = screen.getByLabelText('Default Agent')
    const projectOptions = Array.from(select.querySelectorAll('optgroup[label="Project"] option')).map(
      (o) => o.textContent,
    )
    const userOptions = Array.from(select.querySelectorAll('optgroup[label="User"] option')).map((o) => o.textContent)
    const defaultOptions = Array.from(select.querySelectorAll('optgroup[label="Built-in"] option')).map(
      (o) => o.textContent,
    )
    expect(projectOptions).toEqual(['QA Lead', 'Builder'])
    expect(userOptions).toEqual(['Architect'])
    expect(defaultOptions).toEqual(['Planner'])
  })

  it('saves a project-scoped agent as the project default', async () => {
    const user = userEvent.setup()

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    await user.selectOptions(screen.getByLabelText('Default Agent'), 'qa-lead')
    await user.click(screen.getByTestId('save-btn'))

    expect(mockUpdateProject).toHaveBeenCalledWith(
      defaultProject.id,
      expect.objectContaining({ defaultAgent: 'qa-lead' }),
    )
  })

  it('resets the selection when cancelling', async () => {
    const user = userEvent.setup()

    render(
      <ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={{ ...defaultProject, defaultAgent: 'builder' }} />,
    )

    await user.selectOptions(screen.getByLabelText('Default Agent'), 'architect')
    await user.click(screen.getByTestId('cancel-btn'))

    expect((screen.getByLabelText('Default Agent') as HTMLSelectElement).value).toBe('builder')
  })
})

describe('ProjectSettingsModal — rootDir validation (Criterion 0 & 1)', () => {
  it('calls validate endpoint before saving when rootDir has changed', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/workspace/config/validate')) {
        return { ok: true, json: () => Promise.resolve({ exists: true, workspaces: [] }) }
      }
      return { ok: true, json: () => Promise.resolve({ config: { rootDir: '/custom/path' } }) }
    })

    const user = userEvent.setup()
    mockStoreState.config = { rootDir: '/old/path', setup: [] }

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path')
    await user.clear(input)
    await user.type(input, '/new/path')

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    expect(mockAuthFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/workspace/config/validate'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('/new/path'),
      }),
    )
  })

  it('leaves the form usable after a successful rootDir save', async () => {
    // validate is the only authFetch call on this path — persisting goes through the stores
    mockAuthFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ exists: true, workspaces: [] }) })

    const user = userEvent.setup()
    mockStoreState.config = { rootDir: '/old/path', setup: [] }

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path')
    await user.clear(input)
    await user.type(input, '/new/path')
    await user.click(screen.getByTestId('save-btn'))

    // The saving flag must be cleared on the success path too — the modal stays
    // mounted after closing, so a stuck flag disables every field for good.
    expect((input as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByTestId('cancel-btn') as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows confirmation modal when rootDir does not exist', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/workspace/config/validate')) {
        return { ok: true, json: () => Promise.resolve({ exists: false, workspaces: [], resolvedPath: '/new/path' }) }
      }
      return { ok: true, json: () => Promise.resolve({ config: {} }) }
    })

    const user = userEvent.setup()
    mockStoreState.config = { rootDir: '/old/path', setup: [] }

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path')
    await user.clear(input)
    await user.type(input, '/new/path')

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    expect(screen.getByText(/does not exist/i)).toBeTruthy()
    expect(screen.getByText(/Would you like to create/i)).toBeTruthy()
    expect(screen.getByText('Create')).toBeTruthy()
    expect(screen.getAllByText('Cancel')[0]).toBeTruthy()
  })

  it('creates directory and saves after user clicks Create', async () => {
    mockAuthFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url.includes('/api/workspace/config/validate')) {
        const body = JSON.parse((opts?.body as string) ?? '{}')
        if (body.createIfMissing) {
          return { ok: true, json: () => Promise.resolve({ exists: true, created: true, workspaces: [] }) }
        }
        return { ok: true, json: () => Promise.resolve({ exists: false, workspaces: [] }) }
      }
      return { ok: true, json: () => Promise.resolve({ config: {} }) }
    })

    const user = userEvent.setup()
    mockStoreState.config = { rootDir: '/old/path', setup: [] }

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path')
    await user.clear(input)
    await user.type(input, '/new/path')

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    const createBtn = screen.getByText('Create')
    await user.click(createBtn)

    expect(mockAuthFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/workspace/config/validate'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"createIfMissing":true'),
      }),
    )
    expect(mockSaveConfig).toHaveBeenCalled()
  })

  it('does not save when user clicks Cancel on directory confirmation', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/workspace/config/validate')) {
        return { ok: true, json: () => Promise.resolve({ exists: false, workspaces: [], resolvedPath: '/new/path' }) }
      }
      return { ok: true, json: () => Promise.resolve({ config: {} }) }
    })

    const user = userEvent.setup()
    mockStoreState.config = { rootDir: '/old/path', setup: [] }

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path')
    await user.clear(input)
    await user.type(input, '/new/path')

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    const cancelBtn = screen.getAllByText('Cancel')[0]!
    await user.click(cancelBtn)

    expect(mockSaveConfig).not.toHaveBeenCalled()
  })

  it('shows migration warning when rootDir changes and workspaces exist in old location', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/workspace/config/validate')) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              exists: true,
              workspaces: [{ name: 'fix-bug' }, { name: 'add-feature' }],
              resolvedPath: '/new/path',
            }),
        }
      }
      return { ok: true, json: () => Promise.resolve({ config: {} }) }
    })

    const user = userEvent.setup()
    mockStoreState.config = { rootDir: '/old/path', setup: [] }

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path')
    await user.clear(input)
    await user.type(input, '/new/path')

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    expect(screen.getByText(/will not be migrated/i)).toBeTruthy()
    expect(screen.getByText(/fix-bug/)).toBeTruthy()
    expect(screen.getByText(/add-feature/)).toBeTruthy()
  })

  it('requires explicit confirmation (dedicated button) before applying rootDir change when workspaces exist', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/workspace/config/validate')) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              exists: true,
              workspaces: [{ name: 'fix-bug' }, { name: 'add-feature' }, { name: 'refactor' }],
              resolvedPath: '/new/path',
            }),
        }
      }
      return { ok: true, json: () => Promise.resolve({ config: {} }) }
    })

    const user = userEvent.setup()
    mockStoreState.config = { rootDir: '/old/path', setup: [] }

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path')
    await user.clear(input)
    await user.type(input, '/new/path')

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    const confirmBtn = screen.getByText(/Confirm change/i)
    expect(confirmBtn).toBeTruthy()

    await user.click(confirmBtn)

    expect(mockSaveConfig).toHaveBeenCalled()
  })

  it('does not save when user dismisses migration warning without confirming', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/workspace/config/validate')) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              exists: true,
              workspaces: [{ name: 'fix-bug' }],
              resolvedPath: '/new/path',
            }),
        }
      }
      return { ok: true, json: () => Promise.resolve({ config: {} }) }
    })

    const user = userEvent.setup()
    mockStoreState.config = { rootDir: '/old/path', setup: [] }

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path')
    await user.clear(input)
    await user.type(input, '/new/path')

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    const cancelBtn = screen.getAllByText('Cancel')[0]!
    await user.click(cancelBtn)

    expect(mockSaveConfig).not.toHaveBeenCalled()
  })

  it('skips validation when rootDir field is empty', async () => {
    const user = userEvent.setup()

    mockStoreState.config = { rootDir: '/old/path', setup: [] }

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const input = screen.getByPlaceholderText('/absolute/or/relative/path')
    await user.clear(input)

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    expect(mockAuthFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/workspace/config/validate'),
      expect.anything(),
    )
    expect(mockSaveConfig).toHaveBeenCalled()
  })
})
