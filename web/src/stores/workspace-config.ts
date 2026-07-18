import { create } from 'zustand'
import type { WorkspaceConfig } from '@shared/workspace.js'
import { authFetch } from '../lib/api'

interface WorkspaceConfigStore {
  config: WorkspaceConfig | null
  loading: boolean

  fetchConfig: (workdir: string) => Promise<void>
  saveConfig: (workdir: string, config: WorkspaceConfig) => Promise<void>
}

export const useWorkspaceConfigStore = create<WorkspaceConfigStore>()((set) => ({
  config: null,
  loading: false,

  fetchConfig: async (workdir) => {
    set({ loading: true })
    try {
      const res = await authFetch(`/api/workspace/config?workdir=${encodeURIComponent(workdir)}`)
      const data = await res.json()
      set({ config: data.config ?? null, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  saveConfig: async (workdir, config) => {
    const res = await authFetch(`/api/workspace/config?workdir=${encodeURIComponent(workdir)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!res.ok) throw new Error('Failed to save workspace config')
    const data = await res.json()
    set({ config: data.config ?? config })
  },
}))
