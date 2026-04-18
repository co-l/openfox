import { create } from 'zustand'
import { authFetch } from '../lib/api'
import { saveEntity } from './utils'

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
  defaultIds: string[]
  modifiedIds: string[]
  loading: boolean
  fetchCommands: () => Promise<void>
  fetchDefaultIds: () => Promise<void>
  fetchCommand: (commandId: string) => Promise<CommandFull | null>
  createCommand: (command: CommandFull) => Promise<{ success: boolean; error?: string }>
  updateCommand: (id: string, command: Partial<CommandFull>) => Promise<{ success: boolean; error?: string }>
  deleteCommand: (commandId: string) => Promise<boolean>
  restoreDefault: (commandId: string) => Promise<boolean>
  restoreAllDefaults: () => Promise<boolean>
}

export const useCommandsStore = create<CommandsState>((set, get) => ({
  commands: [],
  defaultIds: [],
  modifiedIds: [],
  loading: false,

  fetchDefaultIds: async () => {
    try {
      const res = await authFetch('/api/commands/default-ids')
      const data = await res.json()
      set({ defaultIds: data.ids ?? [] })
    } catch { /* ignore */ }
  },

  fetchCommands: async () => {
    set({ loading: true })
    try {
      const res = await authFetch('/api/commands')
      const data = await res.json()
      set({
        commands: data.commands ?? [],
        defaultIds: data.defaultIds ?? get().defaultIds,
        modifiedIds: data.modifiedIds ?? [],
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  },

  fetchCommand: async (commandId: string) => {
    try {
      const res = await authFetch(`/api/commands/${commandId}`)
      if (!res.ok) return null
      return await res.json() as CommandFull
    } catch {
      return null
    }
  },

  createCommand: async (command: CommandFull) => {
    const result = await saveEntity('POST', '/api/commands', command as unknown as Record<string, unknown>)
    if (result.success) await get().fetchCommands()
    return result
  },

  updateCommand: async (id: string, command: Partial<CommandFull>) => {
    const result = await saveEntity('PUT', `/api/commands/${id}`, command as unknown as Record<string, unknown>)
    if (result.success) await get().fetchCommands()
    return result
  },

  deleteCommand: async (commandId: string) => {
    try {
      const res = await authFetch(`/api/commands/${commandId}`, { method: 'DELETE' })
      if (res.ok) {
        set({ commands: get().commands.filter(c => c.id !== commandId) })
        return true
      }
      return false
    } catch {
      return false
    }
  },

  restoreDefault: async (commandId: string) => {
    try {
      const res = await authFetch(`/api/commands/${commandId}/restore-default`, { method: 'POST' })
      if (res.ok) {
        await get().fetchCommands()
        return true
      }
      return false
    } catch {
      return false
    }
  },

  restoreAllDefaults: async () => {
    try {
      const res = await authFetch('/api/commands/restore-all-defaults', { method: 'POST' })
      if (res.ok) {
        await get().fetchCommands()
        return true
      }
      return false
    } catch {
      return false
    }
  },
}))
