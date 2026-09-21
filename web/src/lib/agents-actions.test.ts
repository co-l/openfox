// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from './api'
import { clearCache } from './resourceCache'
import { createAgent, updateAgent, deleteAgent, duplicateAgent, type AgentFull } from './agents-actions'

vi.mock('./api', () => ({
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

describe('Agents mutations project scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
    vi.mocked(authFetch).mockResolvedValue(jsonResponse())
  })

  it('sends the project workdir when creating an agent and refreshing the list', async () => {
    await createAgent(agent, 'project', '/projects/client app')

    expect(authFetch).toHaveBeenNthCalledWith(
      1,
      '/api/agents?workdir=%2Fprojects%2Fclient%20app',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(authFetch).toHaveBeenNthCalledWith(2, '/api/agents?workdir=%2Fprojects%2Fclient%20app')
  })

  it('sends the project workdir when updating an agent and refreshing the list', async () => {
    await updateAgent(agent.metadata.id, agent, 'C:\\projects\\client')

    expect(authFetch).toHaveBeenNthCalledWith(
      1,
      '/api/agents/custom-reviewer?workdir=C%3A%5Cprojects%5Cclient',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(authFetch).toHaveBeenNthCalledWith(2, '/api/agents?workdir=C%3A%5Cprojects%5Cclient')
  })

  it('keeps global requests unchanged when no project workdir is available', async () => {
    await createAgent(agent, 'user')

    expect(authFetch).toHaveBeenNthCalledWith(1, '/api/agents', expect.objectContaining({ method: 'POST' }))
    expect(authFetch).toHaveBeenNthCalledWith(2, '/api/agents')
  })

  it('deletes an agent then refreshes the scoped list', async () => {
    await deleteAgent(agent.metadata.id, '/repo/a')

    expect(authFetch).toHaveBeenNthCalledWith(
      1,
      '/api/agents/custom-reviewer?workdir=%2Frepo%2Fa',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(authFetch).toHaveBeenNthCalledWith(2, '/api/agents?workdir=%2Frepo%2Fa')
  })

  it('duplicates an agent then refreshes the scoped list', async () => {
    await duplicateAgent(agent.metadata.id, 'project', '/repo/a')

    expect(authFetch).toHaveBeenNthCalledWith(
      1,
      '/api/agents/custom-reviewer/duplicate?workdir=%2Frepo%2Fa',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(authFetch).toHaveBeenNthCalledWith(2, '/api/agents?workdir=%2Frepo%2Fa')
  })
})
