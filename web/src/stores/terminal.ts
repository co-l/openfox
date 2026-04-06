import { create } from 'zustand'
import { wsClient } from '../lib/ws'

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
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
}

export interface TerminalState {
  isOpen: boolean
  sessions: TerminalSession[]
  workdir: string | null
  setOpen: (open: boolean) => void
  toggleOpen: () => void
  setWorkdir: (workdir: string | null) => void
  createSession: (workdir?: string) => void
  writeSession: (sessionId: string, data: string) => void
  resizeSession: (sessionId: string, cols: number, rows: number) => void
  killSession: (sessionId: string) => void
  handleMessage: (message: { type: string; payload?: any }) => void
}

export const useTerminalStore = create<TerminalState>((set, get) => {
  return {
    isOpen: false,
    sessions: [],
    workdir: null,

    setOpen: (open) => set({ isOpen: open }),

    toggleOpen: () => set(state => ({ isOpen: !state.isOpen })),

    setWorkdir: (workdir) => set({ workdir }),

    createSession: (workdir) => {
      sendTerminalMessage('terminal.create', {
        workdir: workdir ?? get().workdir ?? undefined,
      })
    },

    writeSession: (sessionId, data) => {
      sendTerminalMessage('terminal.write', { sessionId, data })
    },

    resizeSession: (sessionId, cols, rows) => {
      sendTerminalMessage('terminal.resize', { sessionId, cols, rows })
    },

    killSession: (sessionId) => {
      sendTerminalMessage('terminal.kill', { sessionId })
    },

    handleMessage: (message) => {
      switch (message.type) {
        case 'terminal.created': {
          const { sessionId, workdir } = message.payload
          set(state => ({
            sessions: [...state.sessions, { id: sessionId, workdir }],
          }))
          break
        }
        case 'terminal.killed': {
          const { sessionId } = message.payload
          set(state => ({
            sessions: state.sessions.filter(s => s.id !== sessionId),
          }))
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