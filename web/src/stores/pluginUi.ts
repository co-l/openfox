import { create } from 'zustand'

function stateKey(pluginId: string, panelId: string | undefined, key: string): string {
  return `${pluginId}:${panelId ?? ''}:${key}`
}

export interface ActivePluginPanel {
  pluginId: string
  panelId: string
}

interface PluginUiStore {
  values: Record<string, unknown>
  activePanel: ActivePluginPanel | null
  setState: (pluginId: string, panelId: string | undefined, key: string, value: unknown) => void
  read: (pluginId: string, panelId: string | undefined, key: string) => unknown
  clearPanel: (pluginId: string, panelId: string) => void
  openPanel: (pluginId: string, panelId: string) => void
  closePanel: () => void
}

export const usePluginUiStore = create<PluginUiStore>((set, get) => ({
  values: {},
  activePanel: null,
  setState: (pluginId, panelId, key, value) =>
    set((state) => ({ values: { ...state.values, [stateKey(pluginId, panelId, key)]: value } })),
  read: (pluginId, panelId, key) => get().values[stateKey(pluginId, panelId, key)],
  clearPanel: (pluginId, panelId) =>
    set((state) => {
      const prefix = `${pluginId}:${panelId}:`
      return {
        values: Object.fromEntries(Object.entries(state.values).filter(([key]) => !key.startsWith(prefix))),
      }
    }),
  openPanel: (pluginId, panelId) => set({ activePanel: { pluginId, panelId } }),
  closePanel: () => set({ activePanel: null }),
}))
