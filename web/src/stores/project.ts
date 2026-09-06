import { create } from 'zustand'
import { authFetch } from '../lib/api'
import { projectsResource, projectResource } from '../lib/resources'
import type { Project } from '@shared/types.js'

interface ProjectState {
  /**
   * Which project is open — local UI state layered on top of the resources.
   * The project data itself lives in projectsResource (list) and
   * projectResource(projectId) (detail); the store never holds server data.
   */
  currentProjectId: string | null
  setCurrentProjectId: (id: string | null) => void
  clearProject: () => void

  // Mutations delegating to the resource cache so all subscribers converge.
  createProject: (
    name: string,
    workdir: string,
  ) => Promise<Project | { error: { code: string; path?: string; message?: string } } | null>
  updateProject: (
    projectId: string,
    updates: {
      name?: string
      customInstructions?: string | null
      dangerLevel?: string | null
      defaultAgent?: string | null
      favoriteWorkflowId?: string | null
      autoAnswerQuestions?: boolean | null
      autoActionTimeoutSeconds?: number | null
    },
  ) => Promise<Project | null>
  deleteProject: (projectId: string) => Promise<boolean>
  toggleStar: (projectId: string, isStarred: boolean) => Promise<boolean>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProjectId: null,

  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  clearProject: () => set({ currentProjectId: null }),

  createProject: async (name, workdir) => {
    try {
      const res = await authFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, workdir }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return {
          error: { code: data.code || 'UNKNOWN', path: data.path, message: data.error },
        } as const
      }
      const data = await res.json()
      await projectsResource.refresh()
      return (data.project as Project) ?? null
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
      await Promise.all([projectsResource.refresh(), projectResource.refresh(projectId)])
      return (data.project as Project) ?? null
    } catch {
      return null
    }
  },

  deleteProject: async (projectId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}`, { method: 'DELETE' })
      if (!res.ok) return false
      await projectsResource.refresh()
      projectResource.invalidate(projectId)
      if (get().currentProjectId === projectId) {
        set({ currentProjectId: null })
      }
      return true
    } catch {
      return false
    }
  },

  toggleStar: async (projectId, isStarred) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/star`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isStarred }),
      })
      if (!res.ok) return false
      await projectsResource.refresh()
      if (get().currentProjectId === projectId) {
        await projectResource.refresh(projectId)
      }
      return true
    } catch {
      return false
    }
  },
}))
