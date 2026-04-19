import { create } from 'zustand'
import { authFetch } from '../lib/api'
import { saveEntity } from './utils'
import { fetchItems } from './fetch-items'

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
  metadata: { id: string; name: string; description: string; subagent: boolean; allowedTools: string[]; color?: string; results?: string[] }
  prompt: string
}

const DEFAULT_AGENT_COLOR = '#6b7280'

export function getAgentColor(agents: AgentInfo[], agentId: string): string {
  return agents.find(a => a.id === agentId)?.color ?? DEFAULT_AGENT_COLOR
}

interface AgentsState {
  defaults: AgentInfo[]
  userItems: AgentInfo[]
  loading: boolean
  fetchAgents: () => Promise<void>
  fetchAgent: (agentId: string) => Promise<AgentFull | null>
  fetchDefaultContent: (agentId: string) => Promise<AgentFull | null>
  createAgent: (agent: AgentFull) => Promise<{ success: boolean; error?: string }>
  updateAgent: (id: string, agent: Partial<AgentFull>) => Promise<{ success: boolean; error?: string }>
  deleteAgent: (agentId: string) => Promise<{ success: boolean; error?: string; reason?: string }>
  duplicateAgent: (agentId: string) => Promise<{ success: boolean; error?: string }>
}

export const useAgentsStore = create<AgentsState>((set) => {
  const fetchAgents = async () => {
    await fetchItems('/api/agents', set as Parameters<typeof fetchItems>[1])
  }

  return {
    defaults: [],
    userItems: [],
    loading: false,

    fetchAgents,

    fetchAgent: async (agentId: string) => {
      try {
        const res = await authFetch(`/api/agents/${agentId}`)
        if (!res.ok) return null
        return await res.json() as AgentFull
      } catch {
        return null
      }
    },

    fetchDefaultContent: async (agentId: string) => {
      try {
        const res = await authFetch(`/api/agents/defaults/${agentId}`)
        if (!res.ok) return null
        return await res.json() as AgentFull
      } catch {
        return null
      }
    },

    createAgent: async (agent: AgentFull) => {
      const result = await saveEntity('POST', '/api/agents', agent as unknown as Record<string, unknown>)
      if (result.success) await fetchAgents()
      return result
    },

    updateAgent: async (id: string, agent: Partial<AgentFull>) => {
      const result = await saveEntity('PUT', `/api/agents/${id}`, agent as unknown as Record<string, unknown>)
      if (result.success) await fetchAgents()
      return result
    },

    deleteAgent: async (agentId: string) => {
      try {
        const res = await authFetch(`/api/agents/${agentId}`, { method: 'DELETE' })
        const data = await res.json()
        if (res.ok) {
          set(state => ({
            userItems: state.userItems.filter(a => a.id !== agentId),
          }))
          return { success: true }
        }
        return { success: false, error: data.error ?? 'Failed to delete' }
      } catch {
        return { success: false, error: 'Network error' }
      }
    },

    duplicateAgent: async (agentId: string) => {
      try {
        const res = await authFetch(`/api/agents/${agentId}/duplicate`, { method: 'POST' })
        const data = await res.json()
        if (res.ok) {
          await fetchAgents()
          return { success: true }
        }
        return { success: false, error: data.error ?? 'Failed to duplicate' }
      } catch {
        return { success: false, error: 'Network error' }
      }
    },
  }
})