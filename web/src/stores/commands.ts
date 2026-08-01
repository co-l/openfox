import { create } from 'zustand'
import { authFetch } from '../lib/api'
import { saveEntity, duplicateEntity } from './utils'
import { fetchItems } from './fetch-items'

export interface CommandInfo {
  id: string
  name: string
  agentMode?: string
  paramNames?: string[]
}

export interface CommandFull {
  metadata: { id: string; name: string; agentMode?: string }
  prompt: string
}

interface CommandsState {
  defaults: CommandInfo[]
  userItems: CommandInfo[]
  projectItems: CommandInfo[]
  loading: boolean
  fetchCommands: () => Promise<void>
  fetchCommand: (commandId: string) => Promise<CommandFull | null>
  fetchDefaultContent: (commandId: string) => Promise<CommandFull | null>
  createCommand: (
    command: CommandFull,
    destination?: 'project' | 'user',
  ) => Promise<{ success: boolean; error?: string }>
  updateCommand: (id: string, command: Partial<CommandFull>) => Promise<{ success: boolean; error?: string }>
  deleteCommand: (commandId: string) => Promise<{ success: boolean; error?: string; reason?: string }>
  duplicateCommand: (
    commandId: string,
    destination?: 'project' | 'user',
  ) => Promise<{ success: boolean; error?: string }>
}

export const useCommandsStore = create<CommandsState>((set, get) => ({
  defaults: [],
  userItems: [],
  projectItems: [],
  loading: false,

  fetchCommands: async () => {
    await fetchItems('/api/commands', set as unknown as (partial: unknown) => void, true)
  },

  fetchCommand: async (commandId: string) => {
    try {
      const res = await authFetch(`/api/commands/${commandId}`)
      if (!res.ok) return null
      return (await res.json()) as CommandFull
    } catch {
      return null
    }
  },

  fetchDefaultContent: async (commandId: string) => {
    try {
      const res = await authFetch(`/api/commands/defaults/${commandId}`)
      if (!res.ok) return null
      return (await res.json()) as CommandFull
    } catch {
      return null
    }
  },

  createCommand: async (command: CommandFull, destination?: 'project' | 'user') => {
    const result = await saveEntity('POST', '/api/commands', {
      ...command,
      destination,
    } as unknown as Record<string, unknown>)
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
      const data = await res.json()
      if (res.ok) {
        set((state) => ({
          userItems: state.userItems.filter((c) => c.id !== commandId),
          projectItems: state.projectItems.filter((c) => c.id !== commandId),
        }))
        return { success: true }
      }
      return { success: false, error: data.error ?? 'Failed to delete' }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  duplicateCommand: async (commandId: string, destination?: 'project' | 'user') => {
    return duplicateEntity(`/api/commands/${commandId}/duplicate`, () => get().fetchCommands(), destination)
  },
}))
