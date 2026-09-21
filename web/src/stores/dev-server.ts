import { create } from 'zustand'
import type { DevServerConfig, DevServerStatus } from '@shared/dev-server.js'
import type { ServerMessage, DevServerOutputPayload, DevServerStatePayload } from '@shared/protocol.js'
// Authorized exception: dev-server logs are WS-streamed and append-only, so they
// stay here (rAF-batched, capped); status/config live in the resource cache and
// every lifecycle action writes through to it.
import { authFetch } from '../lib/api'
import { createLogBuffer } from './utils'
import { snapshot } from '../lib/resourceCache'
import { devServerStatusResource, devServerConfigResource } from '../lib/resources'

export interface LogChunk {
  stream: 'stdout' | 'stderr'
  content: string
  type?: 'marker'
}

const MAX_LOG_CHUNKS = 2000

const capLogs = (logs: LogChunk[]): LogChunk[] => (logs.length > MAX_LOG_CHUNKS ? logs.slice(-MAX_LOG_CHUNKS) : logs)

interface DevServerStore {
  logsByWorkdir: Record<string, LogChunk[]>

  fetchLogs: (workdir: string) => Promise<void>
  clearLogs: (workdir: string) => Promise<void>
  insertMarker: (workdir: string) => Promise<void>
  start: (workdir: string) => Promise<void>
  stop: (workdir: string) => Promise<void>
  restart: (workdir: string) => Promise<void>
  saveConfig: (workdir: string, config: DevServerConfig) => Promise<void>
  handleMessage: (message: ServerMessage) => void
}

let logBuffer: { workdir: string; stream: 'stdout' | 'stderr'; content: string }[] = []

const devServerUrl = (workdir: string, path: string): string =>
  `/api/dev-server/${path}?workdir=${encodeURIComponent(workdir)}`

export const useDevServerStore = create<DevServerStore>()((set, get) => {
  function flushLogBuffer() {
    if (logBuffer.length === 0) return
    const chunks = logBuffer
    logBuffer = []
    set((state) => {
      const grouped = new Map<string, LogChunk[]>()
      for (const chunk of chunks) {
        const list = grouped.get(chunk.workdir) ?? []
        list.push({ stream: chunk.stream, content: chunk.content })
        grouped.set(chunk.workdir, list)
      }
      let logsByWorkdir = state.logsByWorkdir
      for (const [workdir, newLogs] of grouped) {
        const existing = logsByWorkdir[workdir] ?? []
        logsByWorkdir = { ...logsByWorkdir, [workdir]: capLogs([...existing, ...newLogs]) }
      }
      return { logsByWorkdir }
    })
  }

  const scheduleLogFlush = createLogBuffer(flushLogBuffer)

  /** POST a lifecycle action, write the returned status through, and reset logs on success. */
  const runLifecycleAction = async (workdir: string, path: string) => {
    if (!workdir) return
    try {
      const res = await authFetch(devServerUrl(workdir, path), { method: 'POST' })
      devServerStatusResource.write((await res.json()) as DevServerStatus, workdir)
      set((state) => ({ logsByWorkdir: { ...state.logsByWorkdir, [workdir]: [] } }))
    } catch {
      // ignore
    }
  }

  return {
    logsByWorkdir: {},

    fetchLogs: async (workdir) => {
      if (!workdir) return
      try {
        const res = await authFetch(devServerUrl(workdir, 'logs'))
        const data = (await res.json()) as { logs: LogChunk[] }
        set((state) => ({ logsByWorkdir: { ...state.logsByWorkdir, [workdir]: capLogs(data.logs ?? []) } }))
      } catch {
        // ignore
      }
    },

    clearLogs: async (workdir) => {
      if (!workdir) return
      try {
        await authFetch(devServerUrl(workdir, 'clear-logs'), { method: 'POST' })
        set((state) => ({ logsByWorkdir: { ...state.logsByWorkdir, [workdir]: [] } }))
      } catch {
        // ignore
      }
    },

    insertMarker: async (workdir) => {
      if (!workdir) return
      try {
        await authFetch(devServerUrl(workdir, 'insert-marker'), { method: 'POST' })
        await get().fetchLogs(workdir)
      } catch {
        // ignore
      }
    },

    start: (workdir) => runLifecycleAction(workdir, 'start'),

    stop: async (workdir) => {
      if (!workdir) return
      try {
        const res = await authFetch(devServerUrl(workdir, 'stop'), { method: 'POST' })
        devServerStatusResource.write((await res.json()) as DevServerStatus, workdir)
      } catch {
        // ignore
      }
    },

    restart: (workdir) => runLifecycleAction(workdir, 'restart'),

    saveConfig: async (workdir, config) => {
      if (!workdir) return
      try {
        const res = await authFetch(devServerUrl(workdir, 'config'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        })
        const data = (await res.json()) as { config?: DevServerConfig | null }
        devServerConfigResource.write(data.config ?? config, workdir)
        await devServerStatusResource.refresh(workdir)
      } catch {
        // ignore
      }
    },

    handleMessage: (message) => {
      switch (message.type) {
        case 'devServer.output': {
          const payload = message.payload as DevServerOutputPayload
          logBuffer.push({ workdir: payload.workdir, stream: payload.stream, content: payload.content })
          scheduleLogFlush()
          break
        }
        case 'devServer.state': {
          const payload = message.payload as DevServerStatePayload
          const current = snapshot<DevServerStatus>(devServerStatusResource.keyOf(payload.workdir)).data
          const next: DevServerStatus = current
            ? {
                ...current,
                state: payload.state,
                errorMessage: payload.errorMessage,
                ...(payload.url !== undefined ? { url: payload.url } : {}),
                ...(payload.inspectProxyPort !== undefined ? { inspectProxyPort: payload.inspectProxyPort } : {}),
              }
            : {
                state: payload.state,
                url: payload.url ?? null,
                hotReload: false,
                config: null,
                errorMessage: payload.errorMessage,
                inspectProxyPort: payload.inspectProxyPort ?? null,
              }
          devServerStatusResource.write(next, payload.workdir)
          break
        }
      }
    },
  }
})
