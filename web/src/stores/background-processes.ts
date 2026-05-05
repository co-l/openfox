import { create } from 'zustand'
import type { BackgroundProcess, LogLine } from '@shared/protocol.js'
import { authFetch } from '../lib/api'
import { createLogBuffer } from './utils'

interface BackgroundProcessStore {
  processes: BackgroundProcess[]
  logs: Record<string, LogLine[]>
  loading: boolean

  setProcesses: (processes: BackgroundProcess[]) => void
  addProcess: (process: BackgroundProcess) => void
  updateProcess: (processId: string, updates: Partial<BackgroundProcess>) => void
  removeProcess: (processId: string) => void
  stopProcess: (processId: string, sessionId: string) => Promise<void>
  appendLog: (processId: string, stream: 'stdout' | 'stderr', content: string) => void
  setLogs: (processId: string, logs: LogLine[]) => void
  clearLogs: (processId: string) => void
  handleMessage: (type: string, payload: Record<string, unknown>) => void
}

let logBuffer: { processId: string; stream: 'stdout' | 'stderr'; content: string }[] = []

export const useBackgroundProcessesStore = create<BackgroundProcessStore>()((set, get) => {
  function flushLogBuffer() {
    if (logBuffer.length === 0) return
    const chunks = logBuffer
    logBuffer = []
    set((state) => {
      const newLogs = { ...state.logs }
      for (const chunk of chunks) {
        const existing = newLogs[chunk.processId] ?? []
        newLogs[chunk.processId] = [
          ...existing,
          { offset: existing.length, content: chunk.content, timestamp: Date.now(), stream: chunk.stream },
        ]
      }
      return { logs: newLogs }
    })
  }

  const scheduleLogFlush = createLogBuffer(flushLogBuffer)

  return {
    processes: [],
    logs: {},
    loading: false,

    setProcesses: (processes) => set({ processes }),

    addProcess: (process) =>
      set((state) => ({
        processes: [...state.processes, process],
      })),

    updateProcess: (processId, updates) =>
      set((state) => ({
        processes: state.processes.map((p) => (p.id === processId ? { ...p, ...updates } : p)),
      })),

    removeProcess: (processId) =>
      set((state) => ({
        processes: state.processes.filter((p) => p.id !== processId),
        logs: Object.fromEntries(Object.entries(state.logs).filter(([key]) => key !== processId)),
      })),

    stopProcess: async (processId, sessionId) => {
      try {
        const res = await authFetch(`/api/sessions/${sessionId}/background-process/${processId}/stop`, {
          method: 'POST',
        })
        if (res.ok) {
          get().removeProcess(processId)
        }
      } catch {
        // ignore
      }
    },

    appendLog: (processId, stream, content) => {
      logBuffer.push({ processId, stream, content })
      scheduleLogFlush()
    },

    setLogs: (processId, logs) =>
      set((state) => ({
        logs: { ...state.logs, [processId]: logs },
      })),

    clearLogs: (processId) =>
      set((state) => ({
        logs: { ...state.logs, [processId]: [] },
      })),

    handleMessage: (type, payload) => {
      switch (type) {
        case 'backgroundProcess.started': {
          const { processId, name, pid, status } = payload as {
            processId: string
            name: string
            pid: number
            status: string
          }
          set((state) => ({
            processes: [
              ...state.processes,
              {
                id: processId,
                sessionId: '',
                name,
                command: '',
                cwd: '',
                pid,
                status: status as BackgroundProcess['status'],
                exitCode: null,
                createdAt: Date.now(),
                startedAt: Date.now(),
                endedAt: null,
              },
            ],
          }))
          break
        }
        case 'backgroundProcess.output': {
          const processId = payload.processId as string
          const stream = payload.stream as 'stdout' | 'stderr'
          const content = payload.content as string
          get().appendLog(processId, stream, content)
          break
        }
        case 'backgroundProcess.exited': {
          const processId = payload.processId as string
          const exitCode = payload.exitCode as number | null
          set((state) => ({
            processes: state.processes.map((p) => (p.id === processId ? { ...p, status: 'exited', exitCode } : p)),
          }))
          break
        }
        case 'backgroundProcess.removed': {
          const processId = payload.processId as string
          get().removeProcess(processId)
          break
        }
      }
    },
  }
})
