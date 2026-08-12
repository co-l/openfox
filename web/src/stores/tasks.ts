import { create } from 'zustand'
import { authFetch } from '../lib/api'
import type { ProjectTask, ProjectTaskCounts, ProjectTaskSettings, TaskGateConfig, TaskStatus } from '@shared/types.js'
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

interface TasksState {
  tasks: ProjectTask[]
  settings: ProjectTaskSettings
  counts: ProjectTaskCounts
  gates: TaskGateConfig[]
  loading: boolean
  activeProjectId: string | null
  lastError: string | null
  lastAutoLaunch: { taskId: string; taskTitle: string; sessionId: string; projectId: string } | null

  loadBoard: (projectId: string) => Promise<void>
  loadCounts: (projectId: string) => Promise<void>
  loadGates: (projectId: string) => Promise<void>
  /** Per-project task state counts for list views (e.g. the homepage), keyed by project id. */
  summaries: Record<string, ProjectTaskCounts>
  loadSummaries: (projectIds: string[]) => Promise<void>
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
  moveTask: (projectId: string, taskId: string, to: TaskStatus, reason?: string) => Promise<TaskMoveResult | null>
  setGateValue: (projectId: string, taskId: string, gateId: string, value: string) => Promise<ProjectTask | null>
  setGateConfig: (projectId: string, gates: TaskGateConfig[]) => Promise<boolean>
  setSettings: (projectId: string, settings: Partial<ProjectTaskSettings>) => Promise<boolean>
  reorderTask: (projectId: string, taskId: string, status: TaskStatus, index: number) => Promise<boolean>
  clearBoard: () => void
  clearAutoLaunch: () => void
  handleTasksUpdate: (payload: TasksUpdatePayload) => void
}

const EMPTY_COUNTS: ProjectTaskCounts = { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 }

function applyBoard(
  set: (fn: (state: TasksState) => Partial<TasksState>) => void,
  projectId: string,
  data: {
    tasks?: ProjectTask[]
    settings?: ProjectTaskSettings
    counts?: ProjectTaskCounts
    gates?: TaskGateConfig[]
  },
) {
  set((_state) => ({
    ...(data.tasks ? { tasks: data.tasks } : {}),
    ...(data.settings ? { settings: data.settings } : {}),
    ...(data.counts ? { counts: data.counts } : {}),
    ...(data.gates ? { gates: data.gates } : {}),
    activeProjectId: projectId,
    lastError: null,
  }))
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  settings: { slotLimit: 1, queuePaused: false },
  counts: EMPTY_COUNTS,
  gates: [],
  summaries: {},
  loading: false,
  activeProjectId: null,
  lastError: null,
  lastAutoLaunch: null,

  loadBoard: async (projectId) => {
    set({ loading: true })
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks`)
      if (!res.ok) {
        set({ loading: false })
        return
      }
      const data = await res.json()
      applyBoard(set, projectId, data)
      set({ loading: false })
    } catch {
      set({ loading: false })
    }
  },

  loadCounts: async (projectId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/count`)
      if (!res.ok) return
      const data = await res.json()
      set((state) => ({
        counts: data.counts ?? state.counts,
        activeProjectId: projectId,
      }))
    } catch {
      /* badge stays stale */
    }
  },

  loadGates: async (projectId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/gates`)
      if (!res.ok) return
      const data = await res.json()
      set({ gates: data.gates ?? [] })
    } catch {
      /* board still usable without gates */
    }
  },

  loadSummaries: async (projectIds) => {
    await Promise.all(
      projectIds.map(async (projectId) => {
        try {
          const res = await authFetch(`/api/projects/${projectId}/tasks/count`)
          if (!res.ok) return
          const data = await res.json()
          const counts = data?.counts as ProjectTaskCounts | undefined
          if (!counts) return
          // Skip the state write when nothing changed — guards against callers
          // that refire this (e.g. an effect) turning into a render loop.
          const current = get().summaries[projectId]
          if (
            current &&
            Object.keys(counts).every(
              (k) => current[k as keyof ProjectTaskCounts] === counts[k as keyof ProjectTaskCounts],
            )
          ) {
            return
          }
          set((state) => ({ summaries: { ...state.summaries, [projectId]: counts } }))
        } catch {
          /* a project with a stale/empty summary degrades to "no chips" */
        }
      }),
    )
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
      await get().loadBoard(projectId)
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
      await get().loadBoard(projectId)
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
      await get().loadBoard(projectId)
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
      await get().loadBoard(projectId)
      return data.task
    } catch {
      return null
    }
  },

  moveTask: async (projectId, taskId, to, reason) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/tasks/${taskId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, ...(reason ? { reason } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) {
        set({ lastError: data.error ?? 'Failed to move task' })
        return null
      }
      set({ lastError: null })
      if (data.autoLaunched) set({ lastAutoLaunch: data.autoLaunched })
      // Live updates arrive over WS; refetch defensively to stay canonical.
      await get().loadBoard(projectId)
      return data as TaskMoveResult
    } catch {
      set({ lastError: 'Failed to move task' })
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
      await get().loadBoard(projectId)
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
      set({ gates })
      return true
    } catch {
      return false
    }
  },

  setSettings: async (projectId, settings) => {
    // Apply optimistically: the stepper must respond instantly instead of
    // waiting for the server broadcast round-trip (which can lag or drop,
    // making +/− feel dead on rapid clicks). The server stays authoritative —
    // its push reconciles any disagreement.
    set((state) => (state.activeProjectId === projectId ? { settings: { ...state.settings, ...settings } } : {}))
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
      return true
    } catch {
      return false
    }
  },

  clearBoard: () => {
    set({
      tasks: [],
      gates: [],
      settings: { slotLimit: 1, queuePaused: false },
      counts: EMPTY_COUNTS,
      activeProjectId: null,
    })
  },

  clearAutoLaunch: () => set({ lastAutoLaunch: null }),

  // Streaming/fetch parity: pushed updates have the same shape as GET /tasks.
  handleTasksUpdate: (payload) => {
    // Summaries (homepage chips) follow every project's board, even the one
    // that isn't open — unlike the single-board state below.
    if (payload.counts) {
      set((state) => ({ summaries: { ...state.summaries, [payload.projectId]: payload.counts } }))
    }
    if (payload.projectId !== get().activeProjectId) return
    set((state) => {
      const tasks = payload.tasks ?? state.tasks
      return {
        tasks,
        settings: payload.settings ?? state.settings,
        counts: payload.counts ?? state.counts,
        ...(payload.gates ? { gates: payload.gates } : {}),
        ...(payload.autoLaunched ? { lastAutoLaunch: payload.autoLaunched } : {}),
      }
    })
  },
}))
