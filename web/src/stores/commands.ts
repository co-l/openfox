import { create } from 'zustand'

export interface CommandInfo {
  id: string
  name: string
  agentMode?: string
}

export interface CommandFull {
  metadata: { id: string; name: string; agentMode?: string }
  prompt: string
}

interface CommandsState {
  commands: CommandInfo[]
  loading: boolean
  fetchCommands: () => Promise<void>
  fetchCommand: (commandId: string) => Promise<CommandFull | null>
  createCommand: (command: CommandFull) => Promise<{ success: boolean; error?: string }>
  updateCommand: (id: string, command: Partial<CommandFull>) => Promise<{ success: boolean; error?: string }>
  deleteCommand: (commandId: string) => Promise<boolean>
}

export const useCommandsStore = create<CommandsState>((set, get) => ({
  commands: [],
  loading: false,

  fetchCommands: async () => {
    set({ loading: true })
    try {
      const res = await fetch('/api/commands')
      const data = await res.json()
      set({ commands: data.commands ?? [], loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchCommand: async (commandId: string) => {
    try {
      const res = await fetch(`/api/commands/${commandId}`)
      if (!res.ok) return null
      return await res.json() as CommandFull
    } catch {
      return null
    }
  },

  createCommand: async (command: CommandFull) => {
    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }
      await get().fetchCommands()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  updateCommand: async (id: string, command: Partial<CommandFull>) => {
    try {
      const res = await fetch(`/api/commands/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }
      await get().fetchCommands()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  deleteCommand: async (commandId: string) => {
    try {
      const res = await fetch(`/api/commands/${commandId}`, { method: 'DELETE' })
      if (res.ok) {
        set({ commands: get().commands.filter(c => c.id !== commandId) })
        return true
      }
      return false
    } catch {
      return false
    }
  },
}))
