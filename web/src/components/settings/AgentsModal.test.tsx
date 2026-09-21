// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

interface MockStore {
  (selector?: (state: any) => any): any
  setState: (partial: Record<string, any>) => void
  getState: () => Record<string, any>
}

function mockStore(initial: Record<string, any>): MockStore {
  let state = { ...initial }
  const fn = vi.fn((selector?: (s: typeof state) => any) => {
    return selector ? selector(state) : state
  }) as unknown as MockStore
  fn.setState = (partial: Record<string, any>) => {
    state = { ...state, ...partial }
  }
  fn.getState = () => state
  return fn
}

vi.mock('../../lib/ws', () => ({
  wsClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    subscribe: vi.fn(),
    onStatusChange: vi.fn(),
  },
}))

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(async (url: string) => {
    if (url === '/api/tools') {
      return { ok: true, json: async () => ({ tools: [] }) }
    }
    if (url === '/api/agents') {
      return {
        ok: true,
        json: async () => ({ defaults: [], userItems: [], projectItems: [], modelOverrides: {} }),
      }
    }
    return { ok: true, json: async () => ({ providerId: null, model: null }) }
  }),
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: mockStore({
    currentSession: null,
    setSessionProvider: vi.fn(),
  }),
}))

vi.mock('../../stores/config', () => ({
  useConfigStore: mockStore({
    providers: [],
  }),
}))

const { mockCreateAgent, mockUpdateAgent, mockDeleteAgent, mockDuplicateAgent } = vi.hoisted(() => ({
  mockCreateAgent: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockDeleteAgent: vi.fn(),
  mockDuplicateAgent: vi.fn(),
}))

vi.mock('../../lib/agents-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/agents-actions')>()
  return {
    ...actual,
    createAgent: mockCreateAgent,
    updateAgent: mockUpdateAgent,
    deleteAgent: mockDeleteAgent,
    duplicateAgent: mockDuplicateAgent,
  }
})

import { AgentsModal } from './AgentsModal'

describe('AgentsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('defaults to Agent type when creating a new agent', async () => {
    const user = userEvent.setup()
    render(<AgentsModal isOpen onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /New/i }))

    const agentButton = screen.getByRole('button', { name: 'Agent' })
    const subAgentButton = screen.getByRole('button', { name: 'Sub-agent' })

    expect(agentButton.className).toContain('bg-accent-primary/25')
    expect(subAgentButton.className).not.toContain('bg-accent-primary/25')
  })

  it('finishes saving a new agent and returns to the list view', async () => {
    mockCreateAgent.mockResolvedValue({ success: true })
    const user = userEvent.setup()
    render(<AgentsModal isOpen onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /New/i }))
    await user.type(screen.getByPlaceholderText('My Agent'), 'Helper')
    await user.type(screen.getByPlaceholderText('Instructions for this agent...'), 'Helps with things.')

    await user.click(screen.getByRole('button', { name: /Save/i }))

    expect(screen.getByRole('button', { name: /New/i })).toBeTruthy()
  })
})
