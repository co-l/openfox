import { create } from 'zustand'

export interface WorkflowInfo {
  id: string
  name: string
  description: string
  version: string
}

export interface WorkflowStep {
  id: string
  name: string
  type: 'llm_turn' | 'sub_agent' | 'shell'
  phase: string
  transitions: Array<{ when: { type: string; result?: string }; goto: string }>
  // llm_turn fields
  toolMode?: 'builder' | 'planner'
  kickoffPrompt?: string
  nudgePrompt?: string
  // sub_agent fields
  subAgentType?: string
  prompt?: string
  // shell fields
  command?: string
  timeout?: number
  successExitCodes?: number[]
}

export interface WorkflowFull {
  metadata: { id: string; name: string; description: string; version: string }
  entryStep: string
  settings: { maxIterations: number; maxVerifyRetries: number }
  steps: WorkflowStep[]
}

interface WorkflowsState {
  workflows: WorkflowInfo[]
  loading: boolean
  fetchWorkflows: () => Promise<void>
  fetchWorkflow: (id: string) => Promise<WorkflowFull | null>
  createWorkflow: (workflow: WorkflowFull) => Promise<{ success: boolean; error?: string }>
  updateWorkflow: (id: string, workflow: Partial<WorkflowFull>) => Promise<{ success: boolean; error?: string }>
  deleteWorkflow: (id: string) => Promise<boolean>
  activateWorkflow: (id: string) => Promise<boolean>
}

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
  workflows: [],
  loading: false,

  fetchWorkflows: async () => {
    set({ loading: true })
    try {
      const res = await fetch('/api/workflows')
      const data = await res.json()
      set({ workflows: data.workflows ?? [], loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchWorkflow: async (id: string) => {
    try {
      const res = await fetch(`/api/workflows/${id}`)
      if (!res.ok) return null
      return await res.json() as WorkflowFull
    } catch {
      return null
    }
  },

  createWorkflow: async (workflow: WorkflowFull) => {
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      })
      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }
      await get().fetchWorkflows()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  updateWorkflow: async (id: string, workflow: Partial<WorkflowFull>) => {
    try {
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      })
      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }
      await get().fetchWorkflows()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  deleteWorkflow: async (id: string) => {
    try {
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' })
      if (res.ok) {
        set({ workflows: get().workflows.filter(p => p.id !== id) })
        return true
      }
      return false
    } catch {
      return false
    }
  },

  activateWorkflow: async (id: string) => {
    try {
      const res = await fetch(`/api/workflows/${id}/activate`, { method: 'POST' })
      return res.ok
    } catch {
      return false
    }
  },
}))
