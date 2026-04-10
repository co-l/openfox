import { create } from 'zustand'
import type { DevServerConfig, DevServerState, DevServerStatus } from '@shared/dev-server.js'
import type { ServerMessage, DevServerOutputPayload, DevServerStatePayload } from '@shared/protocol.js'
import { authFetch } from '../lib/api'

interface LogChunk {
  stream: 'stdout' | 'stderr'
  content: string
}

interface DevServerStore {
  workdir: string | null
  status: DevServerStatus | null
  logs: LogChunk[]
  config: DevServerConfig | null
  loading: boolean

  // Actions
  setWorkdir: (workdir: string | null) => void
  fetchStatus: () => Promise<void>
  fetchConfig: () => Promise<void>
  fetchLogs: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  restart: () => Promise<void>
  saveConfig: (config: DevServerConfig) => Promise<void>
  handleMessage: (message: ServerMessage) => void
}

// --- Log streaming buffer (same RAF batching pattern as session store) ---
let logBuffer: LogChunk[] = []
let logRafId: number | null = null
let flushLogBuffer: (() => void) | null = null

function scheduleLogFlush() {
  if (logRafId !== null) return
  logRafId = requestAnimationFrame(() => {
    logRafId = null
    flushLogBuffer?.()
  })
}

export const useDevServerStore = create<DevServerStore>()((set, get) => {
  flushLogBuffer = () => {
    if (logBuffer.length === 0) return
    const chunks = logBuffer
    logBuffer = []
    set(state => ({
      logs: [...state.logs, ...chunks],
    }))
  }

  return {
    workdir: null,
    status: null,
    logs: [],
    config: null,
    loading: false,

    setWorkdir: (workdir) => {
      const prev = get().workdir
      if (prev === workdir) return
      set({ workdir, status: null, logs: [], config: null, loading: true })
      if (workdir) {
        get().fetchStatus()
        get().fetchConfig()
      }
    },

    fetchStatus: async () => {
      const workdir = get().workdir
      if (!workdir) return
      try {
        const res = await authFetch(`/api/dev-server?workdir=${encodeURIComponent(workdir)}`)
        const data: DevServerStatus = await res.json()
        set({ status: data, loading: false })
      } catch {
        set({ loading: false })
      }
    },

    fetchConfig: async () => {
      const workdir = get().workdir
      if (!workdir) return
      try {
        const res = await authFetch(`/api/dev-server/config?workdir=${encodeURIComponent(workdir)}`)
        const data = await res.json()
        set({ config: data.config ?? null })
      } catch {
        // ignore
      }
    },

    fetchLogs: async () => {
      const workdir = get().workdir
      if (!workdir) return
      try {
        const res = await authFetch(`/api/dev-server/logs?workdir=${encodeURIComponent(workdir)}`)
        const data = await res.json()
        const logs: LogChunk[] = (data.logs as { stream: 'stdout' | 'stderr'; content: string }[]).map(entry => ({
          stream: entry.stream,
          content: entry.content,
        }))
        set({ logs })
      } catch {
        // ignore
      }
    },

    start: async () => {
      const workdir = get().workdir
      if (!workdir) return
      try {
        const res = await authFetch(`/api/dev-server/start?workdir=${encodeURIComponent(workdir)}`, { method: 'POST' })
        const data: DevServerStatus = await res.json()
        set({ status: data, logs: [] })
      } catch {
        // ignore
      }
    },

    stop: async () => {
      const workdir = get().workdir
      if (!workdir) return
      try {
        const res = await authFetch(`/api/dev-server/stop?workdir=${encodeURIComponent(workdir)}`, { method: 'POST' })
        const data: DevServerStatus = await res.json()
        set({ status: data })
      } catch {
        // ignore
      }
    },

    restart: async () => {
      const workdir = get().workdir
      if (!workdir) return
      try {
        const res = await authFetch(`/api/dev-server/restart?workdir=${encodeURIComponent(workdir)}`, { method: 'POST' })
        const data: DevServerStatus = await res.json()
        set({ status: data, logs: [] })
      } catch {
        // ignore
      }
    },

    saveConfig: async (config) => {
      const workdir = get().workdir
      if (!workdir) return
      try {
        const res = await authFetch(`/api/dev-server/config?workdir=${encodeURIComponent(workdir)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        })
        const data = await res.json()
        set({ config: data.config ?? config })
        // Re-fetch status since config changed
        get().fetchStatus()
      } catch {
        // ignore
      }
    },

    handleMessage: (message) => {
      const workdir = get().workdir
      if (!workdir) return

      switch (message.type) {
        case 'devServer.output': {
          const payload = message.payload as DevServerOutputPayload
          if (payload.workdir !== workdir) return
          logBuffer.push({ stream: payload.stream, content: payload.content })
          scheduleLogFlush()
          break
        }
        case 'devServer.state': {
          const payload = message.payload as DevServerStatePayload
          if (payload.workdir !== workdir) return
          set(state => ({
            status: state.status ? {
              ...state.status,
              state: payload.state as DevServerState,
              errorMessage: payload.errorMessage,
            } : state.status,
          }))
          break
        }
      }
    },
  }
})
