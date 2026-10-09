// @vitest-environment happy-dom
/**
 * Tests for CreateProjectModal validation logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { validateProjectName } from './shared/validation'
import { CreateProjectModal } from './CreateProjectModal'

const { authFetch, projectsResource } = vi.hoisted(() => ({
  authFetch: vi.fn(),
  projectsResource: { refresh: vi.fn() },
}))

vi.mock('../lib/api', () => ({ authFetch }))
vi.mock('../lib/resources', () => ({ projectsResource }))
vi.mock('../hooks/useConfig', () => ({
  useConfig: () => ({ config: { workdir: 'C:\\Users\\me' }, refresh: vi.fn(), loading: false }),
}))
vi.mock('wouter', () => ({
  useLocation: () => ['/', vi.fn()],
}))
vi.mock('./shared/DirectoryBrowser', () => ({
  DirectoryBrowser: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <div data-testid="directory-browser-mock">
      <button onClick={() => onSelect('D:\\projects')}>choose</button>
    </div>
  ),
}))

describe('CreateProjectModal validation', () => {
  describe('validateProjectName', () => {
    it('should accept valid project names', () => {
      const validNames = ['my-project', 'my_project', 'my.project', 'Project123', 'test-123']

      for (const name of validNames) {
        const result = validateProjectName(name)
        expect(result.valid).toBe(true)
      }
    })

    it('should reject empty project names', () => {
      const result = validateProjectName('')
      expect(result.valid).toBe(false)
      expect((result as { valid: false; error: string }).error).toContain('empty')
    })

    it('should reject project names with spaces', () => {
      const result = validateProjectName('my project')
      expect(result.valid).toBe(false)
      expect((result as { valid: false; error: string }).error).toContain('only contain')
    })

    it('should reject project names with special characters', () => {
      const invalidNames = ['my@project', 'my#project', 'my$project']

      for (const name of invalidNames) {
        const result = validateProjectName(name)
        expect(result.valid).toBe(false)
      }
    })

    it('should accept project names with dots', () => {
      const result = validateProjectName('test.project')
      expect(result.valid).toBe(true)
    })

    it('should accept project names with underscores', () => {
      const result = validateProjectName('test_project')
      expect(result.valid).toBe(true)
    })

    it('should accept project names with hyphens', () => {
      const result = validateProjectName('test-project')
      expect(result.valid).toBe(true)
    })

    it('should reject project names with path separators', () => {
      const result1 = validateProjectName('my/project')
      expect(result1.valid).toBe(false)

      const result2 = validateProjectName('my\\project')
      expect(result2.valid).toBe(false)
    })
  })
})

describe('CreateProjectModal payload parsing', () => {
  it('should correctly extract project from project.state payload', () => {
    // Simulate the server response structure
    const mockMessage = {
      id: 'test-id',
      type: 'project.state',
      payload: {
        project: {
          id: 'proj-123',
          name: 'test-project',
          workdir: '/home/user/test-project',
        },
      },
    }

    // Extract the project like the modal does
    const msg = mockMessage as unknown as { type: string; payload?: unknown }
    const payload = msg.payload as { project: { id: string } }
    const project = payload?.project

    expect(project).toBeDefined()
    expect(project?.id).toBe('proj-123')
  })
})

describe('CreateProjectModal base folder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ project: { id: 'p1', name: 'my-project' } }),
    })
  })

  afterEach(cleanup)

  it('defaults the base folder to the config workdir', async () => {
    render(<CreateProjectModal isOpen onClose={vi.fn()} />)

    const baseFolder = await screen.findByTestId('create-project-base-folder')
    expect(baseFolder.textContent).toContain('C:\\Users\\me')
  })

  it('renders a control to change the base folder', async () => {
    render(<CreateProjectModal isOpen onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /folder/i }))

    await screen.findByRole('button', { name: 'choose' })
  })

  it('updates the full path preview when the base folder is changed', async () => {
    render(<CreateProjectModal isOpen onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /folder/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'choose' }))
    fireEvent.change(await screen.findByTestId('create-project-name-input'), {
      target: { value: 'my-project' },
    })

    const preview = await screen.findByTestId('create-project-path-preview')
    await waitFor(() => expect(preview.textContent).toContain('D:\\projects'))
  })

  it('posts the selected base folder as the project workdir', async () => {
    render(<CreateProjectModal isOpen onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /folder/i }))
    fireEvent.click(screen.getByRole('button', { name: 'choose' }))
    fireEvent.change(screen.getByTestId('create-project-name-input'), { target: { value: 'my-project' } })
    fireEvent.click(screen.getByTestId('create-project-submit-button'))

    await waitFor(() => expect(authFetch).toHaveBeenCalled())
    const body = JSON.parse((authFetch.mock.calls[0] as [string, { body: string }])[1]!.body)
    expect(body.workdir).toBe('D:\\projects\\my-project')
  })
})
