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

const commandsUrl = (path: string, workdir?: string): string =>
  workdir ? `${path}?workdir=${encodeURIComponent(workdir)}` : path

interface CommandsState {
  defaults: CommandInfo[]
  userItems: CommandInfo[]
  projectItems: CommandInfo[]
  loading: boolean
  fetchCommands: (workdir?: string) => Promise<void>
  fetchCommand: (commandId: string, workdir?: string) => Promise<CommandFull | null>
  fetchDefaultContent: (commandId: string) => Promise<CommandFull | null>
  createCommand: (
    command: CommandFull,
    destination?: 'project' | 'user',
    workdir?: string,
  ) => Promise<{ success: boolean; error?: string }>
  updateCommand: (
    id: string,
    command: Partial<CommandFull>,
    workdir?: string,
  ) => Promise<{ success: boolean; error?: string }>
  deleteCommand: (commandId: string, workdir?: string) => Promise<{ success: boolean; error?: string; reason?: string }>
  duplicateCommand: (
    commandId: string,
    destination?: 'project' | 'user',
    workdir?: string,
  ) => Promise<{ success: boolean; error?: string }>
}

export const useCommandsStore = create<CommandsState>((set, get) => ({
  defaults: [],
  userItems: [],
  projectItems: [],
  loading: false,

  fetchCommands: async (workdir?: string) => {
    await fetchItems(commandsUrl('/api/commands', workdir), set as unknown as (partial: unknown) => void, true)
  },

  fetchCommand: async (commandId: string, workdir?: string) => {
    try {
      const res = await authFetch(commandsUrl(`/api/commands/${commandId}`, workdir))
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

  createCommand: async (command: CommandFull, destination?: 'project' | 'user', workdir?: string) => {
    const result = await saveEntity('POST', commandsUrl('/api/commands', workdir), {
      ...command,
      destination,
    } as unknown as Record<string, unknown>)
    if (result.success) await get().fetchCommands(workdir)
    return result
  },

  updateCommand: async (id: string, command: Partial<CommandFull>, workdir?: string) => {
    const result = await saveEntity(
      'PUT',
      commandsUrl(`/api/commands/${id}`, workdir),
      command as unknown as Record<string, unknown>,
    )
    if (result.success) await get().fetchCommands(workdir)
    return result
  },

  deleteCommand: async (commandId: string, workdir?: string) => {
    try {
      const res = await authFetch(commandsUrl(`/api/commands/${commandId}`, workdir), { method: 'DELETE' })
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

  duplicateCommand: async (commandId: string, destination?: 'project' | 'user', workdir?: string) => {
    return duplicateEntity(
      commandsUrl(`/api/commands/${commandId}/duplicate`, workdir),
      () => get().fetchCommands(workdir),
      destination,
    )
  },
}))
