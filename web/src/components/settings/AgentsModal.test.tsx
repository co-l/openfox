/* @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentsModal } from './AgentsModal'

const mocks = vi.hoisted(() => ({
  fetchAgents: vi.fn().mockResolvedValue(undefined),
  fetchAgent: vi.fn(),
  fetchDefaultContent: vi.fn().mockResolvedValue({
    metadata: {
      id: 'planner',
      name: 'Planner',
      description: 'Plans work',
      subagent: false,
      allowedTools: [],
      color: '#6b7280',
    },
    prompt: 'Plan carefully',
  }),
  createAgent: vi.fn().mockResolvedValue({ success: true }),
  updateAgent: vi.fn().mockResolvedValue({ success: true }),
  deleteAgent: vi.fn().mockResolvedValue({ success: true }),
  fetchConfig: vi.fn().mockResolvedValue(undefined),
  userItems: [] as Record<string, unknown>[],
  overrideIds: [] as string[],
}))

vi.mock('../../stores/agents', () => ({
  useAgentsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      defaults: [
        {
          id: 'planner',
          name: 'Planner',
          description: 'Plans work',
          subagent: false,
          allowedTools: [],
          color: '#6b7280',
        },
      ],
      userItems: mocks.userItems,
      overrideIds: mocks.overrideIds,
      loading: false,
      fetchAgents: mocks.fetchAgents,
      fetchAgent: mocks.fetchAgent,
      fetchDefaultContent: mocks.fetchDefaultContent,
      createAgent: mocks.createAgent,
      updateAgent: mocks.updateAgent,
      deleteAgent: mocks.deleteAgent,
    }),
}))

vi.mock('../../stores/config', () => ({
  useConfigStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ providers: [], fetchConfig: mocks.fetchConfig }),
}))

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn().mockResolvedValue({ json: async () => ({ tools: [] }) }),
}))

describe('AgentsModal built-in customization', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    mocks.createAgent.mockClear()
    mocks.updateAgent.mockClear()
    mocks.userItems = []
    mocks.overrideIds = []
  })

  it('duplicates a read-only built-in with a fresh ID instead of updating it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    render(<AgentsModal isOpen onClose={vi.fn()} />)

    expect(screen.queryByTitle('Edit')).toBeNull()
    fireEvent.click(screen.getByTitle('View'))
    await screen.findByText('Duplicate & Customize')

    expect(screen.getByDisplayValue('planner')).toHaveProperty('readOnly', true)
    fireEvent.click(screen.getByText('Duplicate & Customize'))

    expect(screen.getByDisplayValue('planner-copy-1234')).toBeTruthy()
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(mocks.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ id: 'planner-copy-1234' }) }),
      ),
    )
    expect(mocks.updateAgent).not.toHaveBeenCalled()
  })

  it('keeps existing built-in overrides resettable without exposing edit', () => {
    mocks.userItems = [
      {
        id: 'planner',
        name: 'Planner override',
        description: 'Legacy override',
        subagent: false,
        allowedTools: [],
      },
    ]
    mocks.overrideIds = ['planner']

    render(<AgentsModal isOpen onClose={vi.fn()} />)

    expect(screen.queryByTitle('Edit')).toBeNull()
    expect(screen.getByTitle('Delete')).toBeTruthy()
  })

  it('rejects creating a custom agent with a built-in ID', async () => {
    render(<AgentsModal isOpen onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('+ New'))
    fireEvent.change(screen.getByPlaceholderText('My Agent'), { target: { value: 'Planner' } })
    fireEvent.change(screen.getByPlaceholderText('Instructions for this agent...'), { target: { value: 'Prompt' } })
    fireEvent.click(screen.getByText('Save'))

    expect(await screen.findByText('This ID belongs to a built-in agent. Choose a different name.')).toBeTruthy()
    expect(mocks.createAgent).not.toHaveBeenCalled()
  })

  it('duplicates a custom agent using its effective content', async () => {
    mocks.userItems = [
      {
        id: 'reviewer',
        name: 'Reviewer',
        description: 'Reviews work',
        subagent: true,
        allowedTools: [],
      },
    ]
    mocks.fetchAgent.mockResolvedValueOnce({
      metadata: {
        id: 'reviewer',
        name: 'Reviewer',
        description: 'Reviews work',
        subagent: true,
        allowedTools: [],
      },
      prompt: 'Review carefully',
    })
    vi.spyOn(Date, 'now').mockReturnValue(4321)
    render(<AgentsModal isOpen onClose={vi.fn()} />)

    fireEvent.click(screen.getAllByTitle('Duplicate')[1]!)
    await screen.findByDisplayValue('reviewer-copy-4321')

    expect(mocks.fetchAgent).toHaveBeenCalledWith('reviewer')
    expect(mocks.fetchDefaultContent).not.toHaveBeenCalledWith('reviewer')
  })

  it('creates a distinct custom agent from the built-in duplicate action', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5678)
    render(<AgentsModal isOpen onClose={vi.fn()} />)

    fireEvent.click(screen.getByTitle('Duplicate'))
    await screen.findByDisplayValue('planner-copy-5678')
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(mocks.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ id: 'planner-copy-5678' }) }),
      ),
    )
    expect(mocks.updateAgent).not.toHaveBeenCalled()
  })
})
