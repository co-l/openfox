import { create } from 'zustand'

export interface PipelineInfo {
  id: string
  name: string
  description: string
  version: string
}

export interface PipelineStep {
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

export interface PipelineFull {
  metadata: { id: string; name: string; description: string; version: string }
  entryStep: string
  settings: { maxIterations: number; maxVerifyRetries: number }
  steps: PipelineStep[]
}

interface PipelinesState {
  pipelines: PipelineInfo[]
  loading: boolean
  fetchPipelines: () => Promise<void>
  fetchPipeline: (id: string) => Promise<PipelineFull | null>
  createPipeline: (pipeline: PipelineFull) => Promise<{ success: boolean; error?: string }>
  updatePipeline: (id: string, pipeline: Partial<PipelineFull>) => Promise<{ success: boolean; error?: string }>
  deletePipeline: (id: string) => Promise<boolean>
  activatePipeline: (id: string) => Promise<boolean>
}

export const usePipelinesStore = create<PipelinesState>((set, get) => ({
  pipelines: [],
  loading: false,

  fetchPipelines: async () => {
    set({ loading: true })
    try {
      const res = await fetch('/api/pipelines')
      const data = await res.json()
      set({ pipelines: data.pipelines ?? [], loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchPipeline: async (id: string) => {
    try {
      const res = await fetch(`/api/pipelines/${id}`)
      if (!res.ok) return null
      return await res.json() as PipelineFull
    } catch {
      return null
    }
  },

  createPipeline: async (pipeline: PipelineFull) => {
    try {
      const res = await fetch('/api/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pipeline),
      })
      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }
      await get().fetchPipelines()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  updatePipeline: async (id: string, pipeline: Partial<PipelineFull>) => {
    try {
      const res = await fetch(`/api/pipelines/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pipeline),
      })
      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }
      await get().fetchPipelines()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  deletePipeline: async (id: string) => {
    try {
      const res = await fetch(`/api/pipelines/${id}`, { method: 'DELETE' })
      if (res.ok) {
        set({ pipelines: get().pipelines.filter(p => p.id !== id) })
        return true
      }
      return false
    } catch {
      return false
    }
  },

  activatePipeline: async (id: string) => {
    try {
      const res = await fetch(`/api/pipelines/${id}/activate`, { method: 'POST' })
      return res.ok
    } catch {
      return false
    }
  },
}))
