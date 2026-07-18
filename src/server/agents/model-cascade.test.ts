import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDefinition } from './types.js'
import type { LLMClientWithModel } from '../llm/client.js'

const createRuntimeModelClient = vi.fn()
vi.mock('../provider-manager.js', () => ({ createRuntimeModelClient }))

const { resolveAgentLLMClient } = await import('./model-cascade.js')

function client(model: string): LLMClientWithModel {
  return {
    getModel: () => model,
    setModel: vi.fn(),
    getProfile: vi.fn() as never,
    getBackend: () => 'unknown',
    setBackend: vi.fn(),
    complete: vi.fn(),
    async *stream() {},
  }
}

function agent(
  id: string,
  subagent: boolean,
  modelCascade?: Array<{ providerId: string; model: string }>,
): AgentDefinition {
  return {
    metadata: {
      id,
      name: id,
      description: '',
      subagent,
      allowedTools: [],
      ...(modelCascade ? { modelCascade } : {}),
    },
    prompt: 'Prompt',
  }
}

describe('resolveAgentLLMClient', () => {
  beforeEach(() => createRuntimeModelClient.mockReset())

  it('inherits the session client when no cascade is configured', () => {
    const inherited = client('session-model')
    expect(resolveAgentLLMClient(agent('planner', false), inherited)).toBe(inherited)
    expect(createRuntimeModelClient).not.toHaveBeenCalled()
  })

  it('isolates top-level and sub-agent cascades', () => {
    const plannerClient = client('planner-model')
    const verifierClient = client('verifier-model')
    createRuntimeModelClient.mockImplementation((providerId: string) =>
      providerId === 'planner-provider' ? plannerClient : verifierClient,
    )

    const planner = resolveAgentLLMClient(
      agent('planner', false, [{ providerId: 'planner-provider', model: 'planner-model' }]),
      client('session'),
    )
    const verifier = resolveAgentLLMClient(
      agent('verifier', true, [{ providerId: 'verifier-provider', model: 'verifier-model' }]),
      client('session'),
    )

    expect(planner.getModel()).toBe('planner-model')
    expect(verifier.getModel()).toBe('verifier-model')
    expect(createRuntimeModelClient.mock.calls).toEqual([
      ['planner-provider', 'planner-model'],
      ['verifier-provider', 'verifier-model'],
    ])
  })
})
