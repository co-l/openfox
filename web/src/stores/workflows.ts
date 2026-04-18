import { create } from 'zustand'
import { authFetch } from '../lib/api'

const saveWorkflow = async (
  method: 'POST' | 'PUT',
  url: string,
  workflow: WorkflowFull | Partial<WorkflowFull>
): Promise<{ success: boolean; error?: string }> => {
  try {
    const res = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow),
    })
    if (!res.ok) {
      const data = await res.json()
      return { success: false, error: data.error }
    }
    return { success: true }
  } catch {
    return { success: false, error: 'Network error' }
  }
}

export interface WorkflowInfo {
  id: string
  name: string
  description: string
  version: string
  color?: string
  startCondition?: { type: string; result?: string }
}

export interface WorkflowStep {
  id: string
  name: string
  type: 'agent' | 'sub_agent' | 'shell'
  phase: string
  transitions: Array<{ when: { type: string; result?: string }; goto: string }>
  // agent fields
  toolMode?: 'builder' | 'planner'
  // sub_agent fields
  subAgentType?: string
  // shared prompt fields (agent + sub_agent)
  prompt?: string
  nudgePrompt?: string
  // shell fields
  command?: string
  timeout?: number
  successExitCodes?: number[]
}

export interface WorkflowFull {
  metadata: { id: string; name: string; description: string; version: string; color?: string }
  entryStep: string
  settings: { maxIterations: number }
  steps: WorkflowStep[]
  startCondition?: { type: string; result?: string }
}

export interface TemplateVariable {
  name: string
  description: string
}

interface WorkflowsState {
  workflows: WorkflowInfo[]
  defaultIds: string[]
  modifiedIds: string[]
  activeWorkflowId: string
  loading: boolean
  templateVariables: TemplateVariable[]
  fetchWorkflows: () => Promise<void>
  fetchDefaultIds: () => Promise<void>
  fetchTemplateVariables: () => Promise<void>
  fetchWorkflow: (id: string) => Promise<WorkflowFull | null>
  createWorkflow: (workflow: WorkflowFull) => Promise<{ success: boolean; error?: string }>
  updateWorkflow: (id: string, workflow: Partial<WorkflowFull>) => Promise<{ success: boolean; error?: string }>
  deleteWorkflow: (id: string) => Promise<boolean>
  restoreDefault: (workflowId: string) => Promise<boolean>
  restoreAllDefaults: () => Promise<boolean>
}

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
  workflows: [],
  defaultIds: [],
  modifiedIds: [],
  activeWorkflowId: 'default',
  loading: false,
  templateVariables: [],

  fetchTemplateVariables: async () => {
    try {
      const res = await authFetch('/api/workflows/template-variables')
      const data = await res.json()
      set({ templateVariables: data.variables ?? [] })
    } catch { /* ignore */ }
  },

  fetchDefaultIds: async () => {
    try {
      const res = await authFetch('/api/workflows/default-ids')
      const data = await res.json()
      set({ defaultIds: data.ids ?? [] })
    } catch { /* ignore */ }
  },

  fetchWorkflows: async () => {
    set({ loading: true })
    try {
      const res = await authFetch('/api/workflows')
      const data = await res.json()
      set({
        workflows: data.workflows ?? [],
        activeWorkflowId: data.activeWorkflowId ?? 'default',
        defaultIds: data.defaultIds ?? get().defaultIds,
        modifiedIds: data.modifiedIds ?? [],
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  },

  fetchWorkflow: async (id: string) => {
    try {
      const res = await authFetch(`/api/workflows/${id}`)
      if (!res.ok) return null
      return await res.json() as WorkflowFull
    } catch {
      return null
    }
  },

  createWorkflow: async (workflow: WorkflowFull) => {
    const result = await saveWorkflow('POST', '/api/workflows', workflow)
    if (result.success) await get().fetchWorkflows()
    return result
  },

  updateWorkflow: async (id: string, workflow: Partial<WorkflowFull>) => {
    const result = await saveWorkflow('PUT', `/api/workflows/${id}`, workflow)
    if (result.success) await get().fetchWorkflows()
    return result
  },

  deleteWorkflow: async (id: string) => {
    try {
      const res = await authFetch(`/api/workflows/${id}`, { method: 'DELETE' })
      if (res.ok) {
        set({ workflows: get().workflows.filter(p => p.id !== id) })
        return true
      }
      return false
    } catch {
      return false
    }
  },

  restoreDefault: async (workflowId: string) => {
    try {
      const res = await authFetch(`/api/workflows/${workflowId}/restore-default`, { method: 'POST' })
      if (res.ok) {
        await get().fetchWorkflows()
        return true
      }
      return false
    } catch {
      return false
    }
  },

  restoreAllDefaults: async () => {
    try {
      const res = await authFetch('/api/workflows/restore-all-defaults', { method: 'POST' })
      if (res.ok) {
        await get().fetchWorkflows()
        return true
      }
      return false
    } catch {
      return false
    }
  },
}))
