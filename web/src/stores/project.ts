import { create } from 'zustand'
import { authFetch } from '../lib/api'
import type { Project } from '@shared/types.js'

interface ProjectState {
  // Projects
  projects: Project[]
  currentProject: Project | null
  loading: boolean
  
  // Actions
  listProjects: () => Promise<void>
  createProject: (name: string, workdir: string) => Promise<Project | null>
  loadProject: (projectId: string) => Promise<Project | null>
  updateProject: (projectId: string, updates: { name?: string; customInstructions?: string | null }) => Promise<Project | null>
  deleteProject: (projectId: string) => Promise<boolean>
  clearProject: () => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  loading: false,
  
  listProjects: async () => {
    set({ loading: true })
    try {
      const res = await authFetch('/api/projects')
      const data = await res.json()
      set({ projects: data.projects ?? [], loading: false })
    } catch {
      set({ loading: false })
    }
  },
  
  createProject: async (name, workdir) => {
    try {
      const res = await authFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, workdir }),
      })
      if (!res.ok) return null
      const data = await res.json()
      // Refresh project list
      await get().listProjects()
      return data.project
    } catch {
      return null
    }
  },
  
  loadProject: async (projectId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}`)
      if (!res.ok) return null
      const data = await res.json()
      set({ currentProject: data.project })
      if (get().projects.length === 0) {
        await get().listProjects()
      }
      return data.project
    } catch {
      return null
    }
  },
  
  updateProject: async (projectId, updates) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) return null
      const data = await res.json()
      // Update current project if it's the one being updated
      if (get().currentProject?.id === projectId) {
        set({ currentProject: data.project })
      }
      // Refresh project list
      await get().listProjects()
      return data.project
    } catch {
      return null
    }
  },
  
  deleteProject: async (projectId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}`, { method: 'DELETE' })
      if (!res.ok) return false
      // Refresh project list
      await get().listProjects()
      // Clear current project if it was deleted
      if (get().currentProject?.id === projectId) {
        set({ currentProject: null })
      }
      return true
    } catch {
      return false
    }
  },
  
  clearProject: () => {
    set({ currentProject: null })
  },
}))
