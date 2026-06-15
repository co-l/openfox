import { create } from 'zustand'
import { authFetch } from '../lib/api'
import { saveEntity, duplicateEntity } from './utils'

export interface WorkflowCondition {
  type: string
  result?: string
  key?: string
  field?: string
  value?: string
  values?: string[]
}

export interface WorkflowInfo {
  id: string
  name: string
  description: string
  version: string
  color?: string
  startCondition?: WorkflowCondition
  subGroups?: string[]
}

export interface WorkflowStep {
  id: string
  name: string
  type: 'agent' | 'sub_agent' | 'shell'
  phase: string
  transitions: Array<{ when: WorkflowCondition; goto: string; subGroup?: string }>
  toolMode?: 'builder' | 'planner'
  subAgentType?: string
  prompt?: string
  nudgePrompt?: string
  command?: string
  timeout?: number
  successExitCodes?: number[]
  subGroup?: string
}

export interface WorkflowFull {
  metadata: { id: string; name: string; description: string; version: string; color?: string }
  entryStep: string
  settings: { maxIterations: number }
  steps: WorkflowStep[]
  startCondition?: WorkflowCondition
}

export interface TemplateVariable {
  name: string
  description: string
}

interface WorkflowsState {
  defaults: WorkflowInfo[]
  userItems: WorkflowInfo[]
  projectItems: WorkflowInfo[]
  activeWorkflowId: string
  loading: boolean
  templateVariables: TemplateVariable[]
  fetchWorkflows: () => Promise<void>
  fetchTemplateVariables: () => Promise<void>
  fetchWorkflow: (id: string) => Promise<WorkflowFull | null>
  fetchDefaultContent: (id: string) => Promise<WorkflowFull | null>
  createWorkflow: (
    workflow: WorkflowFull,
    destination?: 'project' | 'user',
  ) => Promise<{ success: boolean; error?: string }>
  updateWorkflow: (id: string, workflow: Partial<WorkflowFull>) => Promise<{ success: boolean; error?: string }>
  deleteWorkflow: (id: string) => Promise<{ success: boolean; error?: string; reason?: string }>
  duplicateWorkflow: (id: string, destination?: 'project' | 'user') => Promise<{ success: boolean; error?: string }>
}

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
  defaults: [],
  userItems: [],
  projectItems: [],
  activeWorkflowId: 'default',
  loading: false,
  templateVariables: [],

  fetchTemplateVariables: async () => {
    try {
      const res = await authFetch('/api/workflows/template-variables')
      const data = await res.json()
      set({ templateVariables: data.variables ?? [] })
    } catch {
      /* ignore */
    }
  },

  fetchWorkflows: async () => {
    set({ loading: true })
    try {
      const res = await authFetch('/api/workflows')
      const data = await res.json()
      set({
        defaults: data.defaults ?? [],
        userItems: data.userItems ?? [],
        projectItems: data.projectItems ?? [],
        activeWorkflowId: data.activeWorkflowId ?? 'default',
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
      return (await res.json()) as WorkflowFull
    } catch {
      return null
    }
  },

  fetchDefaultContent: async (id: string) => {
    try {
      const res = await authFetch(`/api/workflows/defaults/${id}`)
      if (!res.ok) return null
      return (await res.json()) as WorkflowFull
    } catch {
      return null
    }
  },

  createWorkflow: async (workflow: WorkflowFull, destination?: 'project' | 'user') => {
    const result = await saveEntity('POST', '/api/workflows', {
      ...workflow,
      destination,
    } as unknown as Record<string, unknown>)
    if (result.success) await get().fetchWorkflows()
    return result
  },

  updateWorkflow: async (id: string, workflow: Partial<WorkflowFull>) => {
    const result = await saveEntity('PUT', `/api/workflows/${id}`, workflow as unknown as Record<string, unknown>)
    if (result.success) await get().fetchWorkflows()
    return result
  },

  deleteWorkflow: async (id: string) => {
    try {
      const res = await authFetch(`/api/workflows/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        set((state) => ({
          userItems: state.userItems.filter((p) => p.id !== id),
        }))
        return { success: true }
      }
      return { success: false, error: data.error ?? 'Failed to delete' }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  duplicateWorkflow: async (id: string, destination?: 'project' | 'user') => {
    return duplicateEntity(`/api/workflows/${id}/duplicate`, () => get().fetchWorkflows(), destination)
  },
}))
