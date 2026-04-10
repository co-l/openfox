import { create } from 'zustand'
import { authFetch } from '../lib/api'

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

const DEFAULT_AGENT_COLOR = '#6b7280' // gray-500 fallback

/** Get agent color by ID. Returns hex color string. */
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

export const useAgentsStore = create<AgentsState>((set, get) => ({
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

  fetchAgents: async () => {
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
  },

  fetchAgent: async (agentId: string) => {
    try {
      const res = await authFetch(`//agents/${agentId}`)
      if (!res.ok) return null
      return await res.json() as AgentFull
    } catch {
      return null
    }
  },

  createAgent: async (agent: AgentFull) => {
    try {
      const res = await authFetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agent),
      })
      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }
      await get().fetchAgents()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  updateAgent: async (id: string, agent: Partial<AgentFull>) => {
    try {
      const res = await authFetch(`//agents/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agent),
      })
      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }
      await get().fetchAgents()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  deleteAgent: async (agentId: string) => {
    try {
      const res = await authFetch(`//agents/${agentId}`, { method: 'DELETE' })
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
      const res = await authFetch(`//agents/${agentId}/restore-default`, { method: 'POST' })
      if (res.ok) {
        await get().fetchAgents()
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
        await get().fetchAgents()
        return true
      }
      return false
    } catch {
      return false
    }
  },
}))
