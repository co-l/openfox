// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from '../lib/api'
import { useAgentsStore, type AgentFull } from './agents'

vi.mock('../lib/api', () => ({
  authFetch: vi.fn(),
}))

const agent: AgentFull = {
  metadata: {
    id: 'custom-reviewer',
    name: 'Reviewer',
    description: 'Reviews changes',
    subagent: true,
    allowedTools: ['read_file'],
  },
  prompt: 'Review the proposed changes.',
}

function jsonResponse(data: unknown = {}): Response {
  return {
    ok: true,
    json: () => Promise.resolve(data),
  } as Response
}

describe('AgentsStore project scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAgentsStore.setState({
      defaults: [],
      userItems: [],
      projectItems: [],
      modelOverrides: {},
      loading: false,
    })
    vi.mocked(authFetch).mockResolvedValue(jsonResponse())
  })

  it('sends the project workdir when creating an agent and refreshing the list', async () => {
    await useAgentsStore.getState().createAgent(agent, 'project', '/projects/client app')

    expect(authFetch).toHaveBeenNthCalledWith(
      1,
      '/api/agents?workdir=%2Fprojects%2Fclient%20app',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(authFetch).toHaveBeenNthCalledWith(2, '/api/agents?workdir=%2Fprojects%2Fclient%20app')
  })

  it('sends the project workdir when updating an agent and refreshing the list', async () => {
    await useAgentsStore.getState().updateAgent(agent.metadata.id, agent, 'C:\\projects\\client')

    expect(authFetch).toHaveBeenNthCalledWith(
      1,
      '/api/agents/custom-reviewer?workdir=C%3A%5Cprojects%5Cclient',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(authFetch).toHaveBeenNthCalledWith(2, '/api/agents?workdir=C%3A%5Cprojects%5Cclient')
  })

  it('keeps global requests unchanged when no project workdir is available', async () => {
    await useAgentsStore.getState().createAgent(agent, 'user')

    expect(authFetch).toHaveBeenNthCalledWith(1, '/api/agents', expect.objectContaining({ method: 'POST' }))
    expect(authFetch).toHaveBeenNthCalledWith(2, '/api/agents')
  })
})
