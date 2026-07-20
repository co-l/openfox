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

  it('omits rootDir from saved config when field is empty', async () => {
    const user = userEvent.setup()

    render(<ProjectSettingsModal isOpen={true} onClose={vi.fn()} project={defaultProject} />)

    const setupInput = screen.getByPlaceholderText('npm install --prefer-offline')
    await user.type(setupInput, 'npm install')

    const saveBtn = screen.getByTestId('save-btn')
    await user.click(saveBtn)

    expect(mockSaveConfig).toHaveBeenCalledWith(
      defaultProject.workdir,
      expect.not.objectContaining({ rootDir: expect.any(String) }),
    )
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

    expect(screen.getByText(/n'existe pas/i)).toBeTruthy()
    expect(screen.getByText(/Voulez-vous le créer/i)).toBeTruthy()
    expect(screen.getByText('Créer')).toBeTruthy()
    expect(screen.getByText('Annuler')).toBeTruthy()
  })

  it('creates directory and saves after user clicks Créer', async () => {
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

    const createBtn = screen.getByText('Créer')
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

  it('does not save when user clicks Annuler on directory confirmation', async () => {
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

    const cancelBtn = screen.getByText('Annuler')
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

    expect(screen.getByText(/workspaces existants/i)).toBeTruthy()
    expect(screen.getByText(/ne seront pas migrés/i)).toBeTruthy()
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

    const confirmBtn = screen.getByText(/Confirmer le changement/i)
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

    const cancelBtn = screen.getByText('Annuler')
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
