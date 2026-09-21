// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowsModal } from './WorkflowsModal'

const { mockResourceState, mockCreateWorkflow, mockUpdateWorkflow, mockDeleteWorkflow, mockDuplicateWorkflow } =
  vi.hoisted(() => ({
    mockResourceState: {
      data: { defaults: [], userItems: [], projectItems: [] } as {
        defaults: Array<{ id: string; name: string; color?: string; scope: 'user' | 'project' | 'builtin' }>
        userItems: Array<{ id: string; name: string; color?: string; scope: 'user' | 'project' | 'builtin' }>
        projectItems: Array<{ id: string; name: string; color?: string; scope: 'user' | 'project' | 'builtin' }>
      },
      loading: false,
      error: undefined,
      refresh: vi.fn(),
    },
    mockCreateWorkflow: vi.fn(async () => ({ success: true })),
    mockUpdateWorkflow: vi.fn(async () => ({ success: true })),
    mockDeleteWorkflow: vi.fn(async () => ({ success: true })),
    mockDuplicateWorkflow: vi.fn(async () => ({ success: true })),
  }))

vi.mock('../../lib/workflows-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/workflows-actions')>()
  return {
    ...actual,
    createWorkflow: mockCreateWorkflow,
    updateWorkflow: mockUpdateWorkflow,
    deleteWorkflow: mockDeleteWorkflow,
    duplicateWorkflow: mockDuplicateWorkflow,
  }
})

vi.mock('../../hooks/useResource', () => ({
  useResource: () => mockResourceState,
}))

const reviewUser = {
  id: 'review',
  name: 'PR Review (Global)',
  description: '',
  version: '1.0.0',
  color: '#10b981',
  scope: 'user' as const,
}
const reviewProject = {
  id: 'review',
  name: 'PR Review (Project)',
  description: '',
  version: '1.0.0',
  color: '#10b981',
  scope: 'project' as const,
}

function deleteConfirmButton(): HTMLButtonElement {
  // ConfirmButton's Delete has visible text; DeleteIcon has only a title.
  return screen
    .getAllByRole('button')
    .find((b) => b.textContent === 'Delete' && !b.hasAttribute('title')) as HTMLButtonElement
}

describe('WorkflowsModal confirm-delete scoping', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mockResourceState.data = {
      defaults: [],
      userItems: [reviewUser],
      projectItems: [reviewProject],
    }
  })

  it('confirms delete on one same-id row without confirming the sibling scope', async () => {
    render(<WorkflowsModal isOpen onClose={vi.fn()} />)

    // Two rows share the id "review" (Custom + Project), each with its own trash icon.
    const trashButtons = screen.getAllByTitle('Delete')
    expect(trashButtons.length).toBe(2)
    expect(screen.getByText('PR Review (Global)')).toBeDefined()
    expect(screen.getByText('PR Review (Project)')).toBeDefined()

    fireEvent.click(trashButtons[0]!)

    // Only the Custom row enters confirm state; the Project row keeps its trash icon.
    expect(screen.getAllByTitle('Delete').length).toBe(1)
    const confirm = deleteConfirmButton()
    expect(confirm).toBeDefined()
    expect(mockDeleteWorkflow).not.toHaveBeenCalled()

    fireEvent.click(confirm)

    await vi.waitFor(() => {
      expect(mockDeleteWorkflow).toHaveBeenCalledWith('review', 'user', undefined)
    })
  })

  it('confirms delete on the project row with the project scope', async () => {
    render(<WorkflowsModal isOpen onClose={vi.fn()} />)

    const trashButtons = screen.getAllByTitle('Delete')
    expect(trashButtons.length).toBe(2)
    fireEvent.click(trashButtons[1]!)

    expect(screen.getAllByTitle('Delete').length).toBe(1)
    fireEvent.click(deleteConfirmButton())

    await vi.waitFor(() => {
      expect(mockDeleteWorkflow).toHaveBeenCalledWith('review', 'project', undefined)
    })
  })
})
