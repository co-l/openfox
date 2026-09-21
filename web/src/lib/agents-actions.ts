import { authFetch } from './api'
import { saveEntity, duplicateEntity } from './entity-mutations'
import { agentsResource, agentsUrl } from './resources'

export interface AgentInfo {
  id: string
  name: string
  description: string
  subagent: boolean
  allowedTools: string[]
  color?: string
  results?: string[]
}

export interface AgentFull {
  metadata: {
    id: string
    name: string
    description: string
    subagent: boolean
    allowedTools: string[]
    color?: string
    results?: string[]
  }
  prompt: string
}

const DEFAULT_AGENT_COLOR = '#6b7280'

export function getAgentColor(agents: AgentInfo[], agentId: string): string {
  return agents.find((a) => a.id === agentId)?.color ?? DEFAULT_AGENT_COLOR
}

export async function createAgent(
  agent: AgentFull,
  destination?: 'project' | 'user',
  workdir?: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await saveEntity('POST', agentsUrl('/api/agents', workdir), {
    ...agent,
    destination,
  } as unknown as Record<string, unknown>)
  if (result.success) await agentsResource.refresh(workdir)
  return result
}

export async function updateAgent(
  id: string,
  agent: Partial<AgentFull>,
  workdir?: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await saveEntity(
    'PUT',
    agentsUrl(`/api/agents/${id}`, workdir),
    agent as unknown as Record<string, unknown>,
  )
  if (result.success) await agentsResource.refresh(workdir)
  return result
}

export async function deleteAgent(
  agentId: string,
  workdir?: string,
): Promise<{ success: boolean; error?: string; reason?: string }> {
  try {
    const res = await authFetch(agentsUrl(`/api/agents/${agentId}`, workdir), { method: 'DELETE' })
    const data = await res.json()
    if (res.ok) {
      await agentsResource.refresh(workdir)
      return { success: true }
    }
    return { success: false, error: data.error ?? 'Failed to delete' }
  } catch {
    return { success: false, error: 'Network error' }
  }
}

export async function duplicateAgent(
  agentId: string,
  destination?: 'project' | 'user',
  workdir?: string,
): Promise<{ success: boolean; error?: string }> {
  return duplicateEntity(
    agentsUrl(`/api/agents/${agentId}/duplicate`, workdir),
    async () => {
      await agentsResource.refresh(workdir)
    },
    destination,
  )
}
