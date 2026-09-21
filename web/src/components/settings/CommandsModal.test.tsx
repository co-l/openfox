// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandsModal } from './CommandsModal'

const { mockCreateCommand, mockUpdateCommand, mockCommandDefaultRefresh } = vi.hoisted(() => ({
  mockCreateCommand: vi.fn(async (_command: { metadata: { id: string; name: string }; prompt: string }) => ({
    success: true,
  })),
  mockUpdateCommand: vi.fn(async () => ({ success: true })),
  mockCommandDefaultRefresh: vi.fn(async () => ({
    metadata: { id: 'add-criteria', name: 'Add criteria', agentMode: '' },
    prompt: 'Add the acceptance criteria',
  })),
}))

vi.mock('../../lib/commands-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/commands-actions')>()
  return {
    ...actual,
    createCommand: mockCreateCommand,
    updateCommand: mockUpdateCommand,
  }
})

const { mockResourceState } = vi.hoisted(() => ({
  mockResourceState: {
    data: {
      defaults: [{ id: 'add-criteria', name: 'Add criteria' }],
      userItems: [],
      projectItems: [],
    },
    loading: false,
    error: undefined,
    refresh: vi.fn(),
  },
}))

vi.mock('../../hooks/useResource', () => ({
  useResource: () => mockResourceState,
}))

vi.mock('../../lib/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/resources')>()
  return {
    ...actual,
    commandDefaultResource: { refresh: mockCommandDefaultRefresh },
  }
})

describe('CommandsModal duplicate from the default view', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mockResourceState.data = {
      defaults: [{ id: 'add-criteria', name: 'Add criteria' }],
      userItems: [],
      projectItems: [],
    }
  })

  it('creates a new copy instead of overwriting the source command', async () => {
    render(<CommandsModal isOpen onClose={() => {}} projectDir="/workdir" />)

    // Open the default command's read-only view.
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(screen.getByText('Default: Add criteria')).toBeTruthy()

    // "Duplicate & Customize" opens the edit form pre-filled as a copy.
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate & Customize' }))
    await waitFor(() => {
      expect(mockCommandDefaultRefresh).toHaveBeenCalledWith('add-criteria')
    })
    expect(screen.getByDisplayValue('Add criteria (copy)')).toBeTruthy()

    // Saving must CREATE a new command (copy id), never update the source.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockCreateCommand).toHaveBeenCalledTimes(1)
    })
    const created = mockCreateCommand.mock.calls[0]![0]
    expect(created.metadata.id).toMatch(/^add-criteria-copy-\d+$/)
    expect(created.metadata.name).toBe('Add criteria (copy)')
    expect(mockUpdateCommand).not.toHaveBeenCalled()
  })
})

describe('CommandsModal plugin provenance', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mockResourceState.data = {
      defaults: [],
      userItems: [{ id: 'plugin-hello', name: 'Plugin hello', pluginId: 'openfox-hello-plugin' }] as never,
      projectItems: [],
    }
  })

  it('marks plugin-contributed commands with a Plugin tag', () => {
    render(<CommandsModal isOpen onClose={() => {}} />)
    expect(screen.getByText('Plugin hello')).toBeTruthy()
    expect(screen.getByText('Plugin')).toBeTruthy()
  })

  it('does not tag user commands without a pluginId', () => {
    mockResourceState.data = {
      defaults: [],
      userItems: [{ id: 'my-command', name: 'My command' }] as never,
      projectItems: [],
    }
    render(<CommandsModal isOpen onClose={() => {}} />)
    expect(screen.getByText('My command')).toBeTruthy()
    expect(screen.queryByText('Plugin')).toBeNull()
  })
})
