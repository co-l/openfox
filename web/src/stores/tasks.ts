import { create } from 'zustand'
import { authFetch } from '../lib/api'
import { boardResource, summariesResource, readBoard, EMPTY_TASK_COUNTS } from '../lib/resources'
import type { ProjectTask, ProjectTaskSettings, TaskGateConfig, TaskStatus } from '@shared/types.js'
import type { TasksUpdatePayload } from '@shared/protocol.js'

export interface TaskCreateInput {
  prompt: string
  attachments?: import('@shared/types.js').Attachment[]
  agentId?: string
  providerId?: string
  model?: string
}

export interface TaskMoveResult {
  task: ProjectTask
  sessionId?: string
  autoLaunched?: { taskId: string; taskTitle: string; sessionId: string; projectId: string }
}

export interface TaskMoveOptions {
  reason?: string
  /** Bind the task to this session (Up-next Start reuses the current one). */
  sessionId?: string
}

interface TasksState {
  /** Local UI state only — board data lives in boardResource (per project). */
  lastError: string | null
  lastAutoLaunch: { taskId: string; taskTitle: string; sessionId: string; projectId: string } | null

  /** WS write-through entry point: pushes update the cache directly (no fetch). */
  handleTasksUpdate: (payload: TasksUpdatePayload) => void

  createTask: (projectId: string, input: TaskCreateInput) => Promise<ProjectTask | null>
  updateTask: (
    projectId: string,
    taskId: string,
    patch: Partial<TaskCreateInput> & {
      agentId?: string | null
      providerId?: string | null
      model?: string | null
    },
  ) => Promise<ProjectTask | null>
  deleteTask: (projectId: string, taskId: string) => Promise<boolean>
  duplicateTask: (projectId: string, taskId: string) => Promise<ProjectTask | null>
  moveTask: (
    projectId: string,
    taskId: string,
    to: TaskStatus,
    options?: TaskMoveOptions,
  ) => Promise<TaskMoveResult | null>
  startTaskPlan: (projectId: string, taskId: string) => Promise<TaskMoveResult | null>
  setGateValue: (projectId: string, taskId: string, gateId: string, value: string) => Promise<ProjectTask | null>
  setGateConfig: (projectId: string, gates: TaskGateConfig[]) => Promise<boolean>
  setSettings: (projectId: string, settings: Partial<ProjectTaskSettings>) => Promise<boolean>
  reorderTask: (projectId: string, taskId: string, status: TaskStatus, index: number) => Promise<boolean>
  /** Persist the workflow picked for a planned task (drives its In Progress launch). */
  setWorkflowChoice: (projectId: string, taskId: string, workflowId: string | null) => Promise<ProjectTask | null>
  clearAutoLaunch: () => void
  clearError: () => void
}

async function refreshBoard(projectId: string): Promise<void> {
  await boardResource.refresh(projectId)
}

export const useTasksStore = create<TasksState>((set) => ({
  lastError: null,
  lastAutoLaunch: null,

  handleTasksUpdate: (payload) => {
    // Summaries (homepage chips) follow every project's board, even the one
    // that isn't open — write-through into the per-project counts resource.
    if (payload.counts) {
      summariesResource.write({ counts: payload.counts }, payload.projectId)
    }
    const existing = readBoard(payload.projectId) ?? {
      tasks: [],
      settings: { slotLimit: 1, queuePaused: false },
      counts: EMPTY_TASK_COUNTS,
      gates: [],
    }
    boardResource.write(
      {
        tasks: payload.tasks ?? existing.tasks,
        settings: payload.settings ?? existing.settings,
        counts: payload.counts ?? existing.counts,
        gates: payload.gates ?? existing.gates,
      },
      payload.projectId,
    )
    if (payload.autoLaunched) set({ lastAutoLaunch: payload.autoLaunched })
  },

  createTask: async (projectId, input) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const data = await res.json()
      if (!res.ok) {
        set({ lastError: data.error ?? 'Failed to create task' })
        return null
      }
      await refreshBoard(projectId)
      return data.task
    } catch {
      set({ lastError: 'Failed to create task' })
      return null
    }
  },

  updateTask: async (projectId, taskId, patch) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) {
        set({ lastError: data.error ?? 'Failed to update task' })
        return null
      }
      await refreshBoard(projectId)
      return data.task
    } catch {
      set({ lastError: 'Failed to update task' })
      return null
    }
  },

  deleteTask: async (projectId, taskId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' })
      if (!res.ok) return false
      await refreshBoard(projectId)
      return true
    } catch {
      return false
    }
  },

  duplicateTask: async (projectId, taskId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/${taskId}/duplicate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) return null
      await refreshBoard(projectId)
      return data.task
    } catch {
      return null
    }
  },

  moveTask: async (projectId, taskId, to, options) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/${taskId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          ...(options?.reason ? { reason: options.reason } : {}),
          ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        set({ lastError: data.error ?? 'Failed to move task' })
        return null
      }
      set({ lastError: null })
      if (data.autoLaunched) set({ lastAutoLaunch: data.autoLaunched })
      // Live updates arrive over WS; refetch defensively to stay canonical.
      await refreshBoard(projectId)
      return data as TaskMoveResult
    } catch {
      set({ lastError: 'Failed to move task' })
      return null
    }
  },

  startTaskPlan: async (projectId, taskId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/${taskId}/start-plan`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        set({ lastError: data.error ?? 'Failed to start plan' })
        return null
      }
      set({ lastError: null })
      await refreshBoard(projectId)
      return data as TaskMoveResult
    } catch {
      set({ lastError: 'Failed to start plan' })
      return null
    }
  },

  setGateValue: async (projectId, taskId, gateId, value) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/${taskId}/gate-values/${gateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const data = await res.json()
      if (!res.ok) {
        set({ lastError: data.error ?? 'Failed to set gate value' })
        return null
      }
      await refreshBoard(projectId)
      return data.task
    } catch {
      set({ lastError: 'Failed to set gate value' })
      return null
    }
  },

  setGateConfig: async (projectId, gates) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/gates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gates }),
      })
      if (!res.ok) return false
      await refreshBoard(projectId)
      return true
    } catch {
      return false
    }
  },

  setSettings: async (projectId, settings) => {
    // Apply optimistically via write-through: the stepper must respond
    // instantly instead of waiting for the server broadcast round-trip (which
    // can lag or drop, making +/− feel dead on rapid clicks). The server stays
    // authoritative — its push reconciles any disagreement.
    const existing = readBoard(projectId)
    if (existing) {
      boardResource.write({ ...existing, settings: { ...existing.settings, ...settings } }, projectId)
    }
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) return false
      return true
    } catch {
      return false
    }
  },

  reorderTask: async (projectId, taskId, status, index) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/${taskId}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, index }),
      })
      if (!res.ok) return false
      await refreshBoard(projectId)
      return true
    } catch {
      return false
    }
  },

  setWorkflowChoice: async (projectId, taskId, workflowId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/${taskId}/workflow-choice`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId }),
      })
      const data = await res.json()
      if (!res.ok) return null
      await refreshBoard(projectId)
      return data.task as ProjectTask
    } catch {
      return null
    }
  },

  clearAutoLaunch: () => set({ lastAutoLaunch: null }),
  clearError: () => set({ lastError: null }),
}))
