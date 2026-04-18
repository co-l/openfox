import { create } from 'zustand'
import { authFetch } from '../lib/api'
import { saveEntity } from './utils'

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
  agents: AgentInfo[]
  defaultIds: string[]
  modifiedIds: string[]
  loading: boolean
  fetchAgents: () => Promise<void>
  fetchDefaultIds: () => Promise<void>
  fetchAgent: (agentId: string) => Promise<AgentFull | null>
  createAgent: (agent: AgentFull) => Promise<{ success: boolean; error?: string }>
  updateAgent: (id: string, agent: Partial<AgentFull>) => Promise<{ success: boolean; error?: string }>
  deleteAgent: (agentId: string) => Promise<boolean>
  restoreDefault: (agentId: string) => Promise<boolean>
  restoreAllDefaults: () => Promise<boolean>
}

export const useAgentsStore = create<AgentsState>((set, get) => {
  const fetchAgents = async () => {
    set({ loading: true })
    try {
      const res = await authFetch('/api/agents')
      const data = await res.json()
      set({
        agents: data.agents ?? [],
        defaultIds: data.defaultIds ?? get().defaultIds,
        modifiedIds: data.modifiedIds ?? [],
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  }

  return {
    agents: [],
    defaultIds: [],
    modifiedIds: [],
    loading: false,

    fetchDefaultIds: async () => {
      try {
        const res = await authFetch('/api/agents/default-ids')
        const data = await res.json()
        set({ defaultIds: data.ids ?? [] })
      } catch { /* ignore */ }
    },

    fetchAgents,

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

    fetchAgent: async (agentId: string) => {
      try {
        const res = await authFetch(`/api/agents/${agentId}`)
        if (!res.ok) return null
        return await res.json() as AgentFull
      } catch {
        return null
      }
    },

    deleteAgent: async (agentId: string) => {
      try {
        const res = await authFetch(`/api/agents/${agentId}`, { method: 'DELETE' })
        if (res.ok) {
          set({ agents: get().agents.filter(a => a.id !== agentId) })
          return true
        }
        return false
      } catch {
        return false
      }
    },

    restoreDefault: async (agentId: string) => {
      try {
        const res = await authFetch(`/api/agents/${agentId}/restore-default`, { method: 'POST' })
        if (res.ok) {
          await fetchAgents()
          return true
        }
        return false
      } catch {
        return false
      }
    },

    restoreAllDefaults: async () => {
      try {
        const res = await authFetch('/api/agents/restore-all-defaults', { method: 'POST' })
        if (res.ok) {
          await fetchAgents()
          return true
        }
        return false
      } catch {
        return false
      }
    },
  }
})
