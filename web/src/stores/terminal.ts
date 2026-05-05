import { create } from 'zustand'
import { wsClient } from '../lib/ws'
import { authFetch } from '../lib/api'

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function sendTerminalMessage(type: string, payload: unknown): void {
  const ws = (wsClient as any).ws
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ id: generateUUID(), type, payload }))
}

export interface TerminalSession {
  id: string
  workdir: string
  projectId: string
}

export interface TerminalState {
  isOpen: boolean
  sessions: TerminalSession[]
  workdir: string | null
  setOpen: (open: boolean) => void
  toggleOpen: () => void
  setWorkdir: (workdir: string | null) => void
  fetchSessions: (projectId?: string) => Promise<void>
  createSession: (workdir?: string, projectId?: string) => Promise<void>
  writeSession: (sessionId: string, data: string) => void
  resizeSession: (sessionId: string, cols: number, rows: number) => void
  killSession: (sessionId: string) => Promise<void>
  handleMessage: (message: { type: string; payload?: any }) => void
}

export const useTerminalStore = create<TerminalState>((set, get) => {
  return {
    isOpen: false,
    sessions: [],
    workdir: null,

    setOpen: (open) => set({ isOpen: open }),

    toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),

    setWorkdir: (workdir) => set({ workdir }),

    fetchSessions: async (projectId?: string) => {
      if (!projectId) {
        set({ sessions: [] })
        return
      }
      try {
        const res = await authFetch(`/api/terminals?projectId=${encodeURIComponent(projectId)}`)
        if (res.ok) {
          const serverSessions = (await res.json()) as TerminalSession[]
          set({ sessions: serverSessions })

          const ws = (wsClient as any).ws
          if (ws && ws.readyState === WebSocket.OPEN) {
            for (const session of serverSessions) {
              ws.send(
                JSON.stringify({
                  id: generateUUID(),
                  type: 'terminal.subscribe',
                  payload: { sessionId: session.id },
                }),
              )
            }
          }
        }
      } catch (e) {
        console.error('Failed to fetch terminals:', e)
      }
    },

    createSession: async (workdir, projectId) => {
      try {
        const res = await authFetch('/api/terminals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workdir: workdir ?? get().workdir ?? undefined, projectId }),
        })
        if (res.ok) {
          const session = (await res.json()) as TerminalSession
          set((state) => ({
            sessions: [...state.sessions, session],
          }))

          const ws = (wsClient as any).ws
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                id: generateUUID(),
                type: 'terminal.subscribe',
                payload: { sessionId: session.id },
              }),
            )
          }
        }
      } catch (e) {
        console.error('Failed to create terminal:', e)
      }
    },

    writeSession: (sessionId, data) => {
      sendTerminalMessage('terminal.write', { sessionId, data })
    },

    resizeSession: (sessionId, cols, rows) => {
      sendTerminalMessage('terminal.resize', { sessionId, cols, rows })
    },

    killSession: async (sessionId) => {
      try {
        const res = await authFetch(`/api/terminals/${sessionId}`, {
          method: 'DELETE',
        })
        if (res.ok) {
          set((state) => ({
            sessions: state.sessions.filter((s) => s.id !== sessionId),
          }))
        }
      } catch (e) {
        console.error('Failed to kill terminal:', e)
      }
    },

    handleMessage: (message) => {
      switch (message.type) {
        case 'terminal.exit': {
          const { sessionId } = message.payload || {}
          if (sessionId) {
            set((state) => {
              const newSessions = state.sessions.filter((s) => s.id !== sessionId)
              if (newSessions.length === 0 && state.isOpen) {
                return { sessions: [], isOpen: false }
              }
              return { sessions: newSessions }
            })
          }
          break
        }
      }
    },
  }
})

wsClient.subscribe((message) => {
  if (message.type?.startsWith('terminal.')) {
    useTerminalStore.getState().handleMessage(message as any)
  }
})
