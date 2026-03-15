import { create } from 'zustand'
import type { Project } from '@openfox/shared'
import type {
  ServerMessage,
  ProjectStatePayload,
  ProjectListPayload,
} from '@openfox/shared/protocol'
import { wsClient } from '../lib/ws'

interface ProjectState {
  // Projects
  projects: Project[]
  currentProject: Project | null
  
  // Actions
  listProjects: () => void
  createProject: (name: string, workdir: string) => void
  loadProject: (projectId: string) => void
  updateProject: (projectId: string, updates: { name?: string; customInstructions?: string | null }) => void
  deleteProject: (projectId: string) => void
  clearProject: () => void
  
  // Internal
  handleServerMessage: (message: ServerMessage) => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  
  listProjects: () => {
    wsClient.send('project.list', {})
  },
  
  createProject: (name, workdir) => {
    wsClient.send('project.create', { name, workdir })
  },
  
  loadProject: (projectId) => {
    wsClient.send('project.load', { projectId })
  },
  
  updateProject: (projectId, updates) => {
    wsClient.send('project.update', { projectId, ...updates })
  },
  
  deleteProject: (projectId) => {
    wsClient.send('project.delete', { projectId })
  },
  
  clearProject: () => {
    set({ currentProject: null })
  },
  
  handleServerMessage: (message) => {
    switch (message.type) {
      case 'project.state': {
        const payload = message.payload as ProjectStatePayload
        set({ currentProject: payload.project })
        break
      }
      
      case 'project.list': {
        const payload = message.payload as ProjectListPayload
        set({ projects: payload.projects })
        break
      }
      
      case 'project.deleted': {
        // Refresh project list
        get().listProjects()
        // Clear current project if it was deleted
        const currentProject = get().currentProject
        const deletedId = (message.payload as { projectId: string }).projectId
        if (currentProject?.id === deletedId) {
          set({ currentProject: null })
        }
        break
      }
    }
  },
}))
